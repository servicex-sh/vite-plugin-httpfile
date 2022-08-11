import path from "node:path";
import fs from "node:fs";

import {parseHttpfile} from "./httpfile";

/**
 * build Vite httpfile plugin
 * @param {boolean=} verbose - enable verbose logging
 * @returns {{name: string, load: function}} vite plugin object
 */
export default function viteHttpfilePlugin(verbose) {

    return {
        name: 'vite-plugin-httpfile', // required, will show up in warnings and errors

        load(source) {
            if (source.endsWith(".http")) {
                let httpfileText = fs.readFileSync(source, 'utf8');
                let targets = parseHttpfile(httpfileText);
                // generate javascript stub code
                let stubCode = targets.map(target => {
                    return target.toCode();
                }).join("\n\n");
                if (verbose) {
                    // generate typescript declaration file
                    let declareFileName = path.basename(source);
                    let declaredApiList = targets.map(target => {
                        return target.toApiDeclare();
                    }).join("\n    ");
                    let moduleDeclareCode = `declare module '*${declareFileName}' {\n    ${declaredApiList}\n}`;
                    // logging
                    let declaredFileName = declareFileName.replace(".http", "-http.d.ts");
                    console.log("=====================" + declaredFileName + "==========================================");
                    console.log(moduleDeclareCode);
                    console.log("=====================" + declareFileName + ".js========================================");
                    console.log(stubCode);
                    console.log("=======================================================================================");
                }
                return stubCode;
            }
        }
    }
}
