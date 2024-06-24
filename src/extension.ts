import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as https from 'https';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.runPythonFile', () => {
        runPythonFile();
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

function runPythonFile() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.languageId === 'python') {
        const pythonFilePath = activeEditor.document.uri.fsPath;

        // Чтение содержимого Python файла
        fs.readFile(pythonFilePath, 'utf8', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage(`Failed to read Python file: ${err.message}`);
                return;
            }

            // Извлечение импортов из содержимого файла
            const imports = extractImports(data);

            // Установка необходимых библиотек
            installLibraries(imports, (installErr) => {
                if (installErr) {
                    vscode.window.showErrorMessage(`Failed to install libraries: ${installErr.message}`);
                } else {
                    // Добавление строки для изменения кодировки консоли
                    const modifiedData = `import sys\nsys.stdout.reconfigure(encoding='utf-8')\n` + data;

                    // Запись модифицированного файла
                    fs.writeFile(pythonFilePath, modifiedData, (writeErr) => {
                        if (writeErr) {
                            vscode.window.showErrorMessage(`Failed to write modified Python file: ${writeErr.message}`);
                            return;
                        }

                        // Запуск Python файла во встроенном терминале
                        const terminal = vscode.window.createTerminal(`Run ${pythonFilePath}`);
                        terminal.show();
                        terminal.sendText(`python "${pythonFilePath}"`);
                    });
                }
            });
        });
    } else {
        vscode.window.showWarningMessage('Open a Python file to run it.');
    }
}

function extractImports(fileContent: string): string[] {
    const importLines = fileContent.match(/^import\s+(\w+)|^from\s+(\w+)/gm) || [];
    return importLines.map(line => {
        const match = line.match(/^import\s+(\w+)|^from\s+(\w+)/);
        return match ? match[1] || match[2] : '';
    }).filter(Boolean);
}

function installLibraries(libraries: string[], callback: (err?: Error) => void) {
    if (libraries.length === 0) {
        callback();
        return;
    }

    const uniqueLibraries = Array.from(new Set(libraries));
    const formattedLibraries = uniqueLibraries.map(lib => lib === 'PIL' ? 'Pillow' : lib);

    const installCommands: string[] = [];
    let completedRequests = 0;
    let hasError = false;

    formattedLibraries.forEach(lib => {
        const url = `https://pypi.org/pypi/${lib}/json`;
        https.get(url, res => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    installCommands.push(`pip install ${lib}`);
                } else {
                    vscode.window.showWarningMessage(`Library ${lib} not found in PyPI`);
                }

                completedRequests++;
                if (completedRequests === formattedLibraries.length) {
                    if (installCommands.length > 0) {
                        const command = installCommands.join(' && ');
                        cp.exec(command, (err, stdout, stderr) => {
                            if (err) {
                                hasError = true;
                                callback(err);
                            } else {
                                vscode.window.showInformationMessage(stdout);
                                callback();
                            }
                        });
                    } else {
                        callback();
                    }
                }
            });
        }).on('error', (e) => {
            hasError = true;
            callback(e);
        });
    });
}
