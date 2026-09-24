/** Opens the browser file picker and reads the chosen file as text. */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = async () => {
            const file = input.files?.[0];
            resolve(file ? { name: file.name, text: await file.text() } : null);
        };
        input.oncancel = () => resolve(null);
        input.click();
    });
}

export function downloadText(fileName: string, text: string, type = 'text/plain'): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
