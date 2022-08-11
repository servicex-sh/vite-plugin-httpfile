const LINE_TERMINATOR = "\n";

function jsonStringify(obj) {
    if (obj === null) {
        return "{}";
    }
    return JSON.stringify(obj, (key, value) => {
        if (value !== null) return value
    });
}

class HttpTarget {

    constructor(index) {
        this.index = index;
        this.name = undefined;
        this.comment = "";
        this.tags = [];
        this.method = "";
        this.url = "";
        this.headers = undefined;
        this.body = undefined;
        this.bodyLines = undefined;
        this.script = undefined;
        this.variables = [];
        this.mockResult = undefined;
    }

    isEmpty() {
        return this.method === "" && this.url === "";
    }

    isMocked() {
        // don't mock if production environment
        return this.mockResult !== undefined && process.env.NODE_ENV !== "production";
    }

    clean() {
        if (this.url) {
            this.url = this.replaceVariables(this.url);
        }
        if (this.body) {
            this.body = this.replaceVariables(this.body.trimEnd());
            this.body = this.body.replaceAll("`", "\\`");
        }
        if (this.name === undefined) {
            this.name = "http" + this.index;
        } else {
            this.name = this.name.replaceAll("-", "");
        }
        let mockLines = this.tags.filter(t => t.startsWith("mock "))
            .map(t => t.substring(5).trim());
        if (mockLines.length > 0) {
            this.mockResult = mockLines.join(LINE_TERMINATOR);
        }
    }

    addTag(tag) {
        this.tags.push(tag);
    }

    addHeader(name, value) {
        if (!this.headers) {
            this.headers = {};
        }
        this.headers[name] = this.replaceVariables(value);
    }

    addScriptLine(line) {

    }

    addBodyLine(line) {
        if (!this.body) {
            this.body = line;
            this.bodyLines = [line];
        } else {
            this.body = this.body + LINE_TERMINATOR + line;
            this.bodyLines.push(line);
        }
    }

    replaceVariables(text) {
        let newText = text;
        while (newText.indexOf("{{") >= 0) {
            const start = newText.indexOf("{{");
            const end = newText.indexOf("}}");
            if (end < start) {
                return newText;
            }
            let name = newText.substring(start + 2, end).trim();
            if (name.startsWith("$")) { // $uuid, $timestamp, $randomInt
                name = name.substring(1);
            }
            if (this.variables.indexOf(name) < 0) {
                this.variables.push(name);
            }
            let value = "${params." + name + " || ''}";
            newText = newText.substring(0, start) + value + newText.substring(end + 2);
        }
        return newText;
    }

    extractGraphqlDoc() {
        let doc = {};
        let variablesOffset = -1;
        let variablesOffsetEnd = -1;
        for (let i = 0; i < this.bodyLines.length; i++) {
            let line = this.bodyLines[i].trim();
            if (line === "{") {
                variablesOffset = i;
            } else if (line === "}") {
                variablesOffsetEnd = i;
            }
        }
        // variables json included in body
        if (variablesOffset > 0 && variablesOffsetEnd > variablesOffset) {
            let query = this.bodyLines.slice(0, variablesOffset).join(LINE_TERMINATOR);
            doc["query"] = query.replaceAll("`", "\\`");
            doc["variables"] = JSON.parse(this.bodyLines.slice(variablesOffset, variablesOffsetEnd + 1).join(LINE_TERMINATOR));
        } else { // query only
            doc["query"] = this.body;
        }
        return doc;
    }

    toApiDeclare() {
        if (this.method === "GRAPHQL") {
            let signatures = [];
            if (this.variables.length > 0) {
                let paramsSignature = "params: {" + this.variables.map(v => {
                    return v + ": string"
                }).join(", ") + "}";
                signatures.push(paramsSignature);
            }
            let doc = this.extractGraphqlDoc();
            if (doc.variables) {
                let graphqlVariableNames = Object.keys(doc.variables);
                if (graphqlVariableNames.length > 0) {
                    let variablesSignature = "variables: {" + graphqlVariableNames.map(v => {
                        return v + ": string"
                    }).join(", ") + "}";
                    signatures.push(variablesSignature);
                }
            }
            return "export function " + this.name + "(" + signatures.join(", ") + "): Promise<Response>;"
        } else { //HTTP request
            if (this.variables.length === 0) {
                return "export function " + this.name + "(): Promise<Response>;"
            } else {
                let paramsSignature = "params: {" + this.variables.map(v => {
                    return v + ": string"
                }).join(", ") + "}";
                return "export function " + this.name + "(" + paramsSignature + "): Promise<Response>;"
            }
        }
    }

    /**
     *
     * @param {string} methodDeclaration
     * @returns {string}
     */
    toMockCode(methodDeclaration) {
        let contentType = this.headers["Accept"] ?? "text/plain";
        let mockedData = this.mockResult;
        if (mockedData.startsWith("<")) {
            contentType = "text/html";
        } else if (mockedData.startsWith("{")) {
            contentType = "application/json";
        }
        return methodDeclaration + " {\n" +
            "  return new Response(`" + mockedData + "`, { status: 200, headers: { 'Content-Type': '" + contentType + "' } });" +
            "\n}";
    }

    toCode() {
        let functionParamNames = [];
        if (this.variables.length > 0) {
            functionParamNames.push("params");
        }
        const mockedRequest = this.isMocked();
        if (this.method === "GRAPHQL") {
            let headers = this.headers ?? {}
            headers["Content-Type"] = "application/json"
            let doc = this.extractGraphqlDoc();
            let query = doc['query'];
            let variablesDecl = "";
            if (doc['variables']) {
                functionParamNames.push("variables");
                variablesDecl = "variables: {..." + jsonStringify(doc['variables']) + ", ...(variables??{})},";
            }
            let methodDeclaration = "export async function " + this.name + "(" + functionParamNames.join(",") + ")";
            if (mockedRequest) {
                return this.toMockCode(methodDeclaration);
            }
            return methodDeclaration + " {\n" +
                "    let doc = {" + variablesDecl + " query: `" + query + "`};\n" +
                "    return await fetch(`" + this.url + "`, {\n" +
                "        method: 'POST',\n" +
                "        headers: " + jsonStringify(headers) + ",\n" +
                "        body: JSON.stringify(doc) \n" +
                "    });\n" +
                "}";
        } else if (this.method === "POST" || this.method === "GET") {
            if (this.body) {
                let methodDeclaration = "export async function " + this.name + "(" + functionParamNames.join(",") + ") ";
                if (mockedRequest) {
                    return this.toMockCode(methodDeclaration);
                }
                return methodDeclaration + " {\n" +
                    "    return await fetch(`" + this.url + "`, {\n" +
                    "        method: '" + this.method + "',\n" +
                    "        headers: " + jsonStringify(this.headers) + ",\n" +
                    "        body: `" + this.body + "`" +
                    "    });\n" +
                    "}";
            } else {
                let methodDeclaration = "export async function " + this.name + "(" + functionParamNames.join(",") + ") ";
                if (mockedRequest) {
                    return this.toMockCode(methodDeclaration);
                }
                return methodDeclaration + " {\n" +
                    "    return await fetch(`" + this.url + "`, {\n" +
                    "        method: '" + this.method + "',\n" +
                    "        headers: " + jsonStringify(this.headers) + "\n" +
                    "    });\n" +
                    "}"
            }
        }
    }
}

/**
 * Parse the httpfile text and return an array of HttpTarget objects.
 * @param text http file content
 * @returns {*[HttpTarget]}
 */
export function parseHttpfile(text) {
    const targets = [];
    let index = 1;
    let httpTarget = new HttpTarget(index);
    for (const l of text.split("\n")) {
        const line = l.trimEnd()
        if ((line === "" || line.startsWith("#!/usr/bin/env")) && httpTarget.isEmpty()) { // ignore empty line or shebang before http target

        } else if (line.startsWith("###")) { // separator
            const comment = line.substring(3).trim();
            if (httpTarget.isEmpty()) {
                httpTarget.comment = comment;
            } else {
                httpTarget.clean();
                targets.push(httpTarget);
                index = index + 1;
                httpTarget = new HttpTarget(index);
                httpTarget.comment = comment;
            }
        } else if (line.startsWith("//") || line.startsWith("#")) { //comment
            if (line.indexOf("@") >= 0) {
                const tag = line.substring(line.indexOf("@") + 1);
                const parts = tag.split(/[=\s]/, 2);
                if (parts[0] === "name") {
                    httpTarget.name = parts[1];
                }
                httpTarget.addTag(tag);
            } else if (!httpTarget.comment) {
                httpTarget.comment = line.substring(2).trim();
            }
        } else if ((line.startsWith("GET ") || line.startsWith("POST ") || line.startsWith("PUT ") || line.startsWith("DELETE ") || line.startsWith("GRAPHQL "))
            && httpTarget.method === "") { // HTTP method & URL
            const parts = line.split(" ", 3); // format as 'POST URL HTTP/1.1'
            httpTarget.method = parts[0];
            httpTarget.url = parts[1].trim();
            if (parts.length > 2) {
                httpTarget.schema = parts[2];
            }
        } else if (line.startsWith("  ")
            && (line.indexOf("  /") >= 0 || line.indexOf("  ?") >= 0 || line.indexOf("  &") >= 0)
            && httpTarget.headers === undefined) { // long request url into several lines
            httpTarget.url = httpTarget.url + line.trim();
        } else if (line.indexOf(":") > 0 && httpTarget.body === undefined && httpTarget.script === undefined) { // http headers
            let offset = line.indexOf(":");
            httpTarget.addHeader(line.slice(0, offset).trim(), line.slice(offset + 1).trim());
        } else if (line.startsWith("<> ")) { //response-ref

        } else {
            if (!(line === "" && httpTarget.body === undefined)) {
                if (line.startsWith("> {%")) { // indicate script
                    let code = line.substring("> {%".length).trim();
                    if (code.endsWith("%}")) {
                        code = code.substring(0, code.length - 2);
                    }
                    httpTarget.script = code;
                } else if (line.startsWith("%}")) { // end of script

                } else if (line.startsWith("> ")) { // insert the script file
                    httpTarget.script = line;
                } else {
                    if (httpTarget.script !== undefined) { //add script line
                        httpTarget.addScriptLine(l);
                    } else { // add body line
                        httpTarget.addBodyLine(l);
                    }
                }
            }
        }
    }
    if (!httpTarget.isEmpty()) {
        httpTarget.clean();
        targets.push(httpTarget)
    }
    return targets;
}

