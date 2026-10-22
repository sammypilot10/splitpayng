/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    // add other env vars here if you have more
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}