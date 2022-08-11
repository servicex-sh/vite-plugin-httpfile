declare module 'vite-plugin-httpfile' {

    export default function viteHttpfilePlugin(verbose?: boolean): { name: string, resolveId: any, load: any };

}
