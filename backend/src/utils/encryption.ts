import CryptoJS from 'crypto-js';

export function encrypt(text: string, passphrase: string): string {
    return CryptoJS.AES.encrypt(text, passphrase).toString();
}

export function decrypt(encryptedText: string, passphrase: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedText, passphrase);
    const result = bytes.toString(CryptoJS.enc.Utf8);

    if (!result) {
        throw new Error('Invalid encryption password or corrupted credentials');
    }

    return result;
}