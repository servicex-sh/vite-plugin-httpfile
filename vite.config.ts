import {defineConfig} from 'vitest/config'

// @ts-ignore
import viteHttpfilePlugin from "./index.js";

export default defineConfig({
    define: {
        'import.meta.vitest': 'undefined',
    },
    test: {
        includeSource: ["tests/**/*.{js,ts}"],
    },
    plugins: [viteHttpfilePlugin(true)]
})
