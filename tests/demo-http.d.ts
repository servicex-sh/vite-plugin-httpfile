declare module "*demo.http" {
    export function myIp(): Promise<Response>;

    export function postTest(params: { nick: string, host: string, uuid: string }): Promise<Response>;

}
