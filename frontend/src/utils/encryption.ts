import CryptoJS from 'crypto-js';

export function encryptCredentials(username: string, password: string, passphrase: string): string {
    const payload = JSON.stringify({ username, password });
    return CryptoJS.AES.encrypt(payload, passphrase).toString();
}