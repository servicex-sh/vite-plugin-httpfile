import {test} from "vitest";
import {myIp, postTest} from './demo.http'

test("my-ip", async () => {
    let response = await myIp();
    console.log(await response.json());
});

test("post-test", async () => {
    let response = await postTest({nick: "test", baseURL: "https://httpbin.org", "uuid": "c8389930-1071-4b88-9676-30b9ba7f2343"});
    console.log(await response.json());
});
