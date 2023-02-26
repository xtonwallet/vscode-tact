'use strict';
import * as path from 'path';
import { errorToDiagnostic } from './tactErrorsToDiagnostics';
import { ContractCollection } from './model/contractsCollection';
import { CompilerContext } from './../tact/src/context';
import { precompile } from './../tact/src/pipeline/precompile';

export class TactCompiler {

    public rootPath: string;

    constructor(rootPath: string) {
        this.rootPath = rootPath;
    }

    public isRootPathSet(): boolean {
        return this.rootPath !== undefined && this.rootPath !== "";
    }

    private async runCompilation(args: {
        file: string,
        outputDir?: string,
    }): Promise<String> {
        let errors = [];
        const ext = path.extname(args.file);
        if (ext !== ".tact") {
            errors[0] = 'Choose Tact source file (.tact).';
            return "";
        }

        try {
            let ctx = new CompilerContext({ shared: {} });
                ctx = precompile(ctx, "", args.file);
        } catch(e: any) {
            return `${args.file}\n${e.message}`;
        }

        return "";
    }

    public async compile(contracts: any): Promise<any> {
        let rawErrors = [];

        for (let fileNameId in contracts.sources) {
            rawErrors.push(await this.runCompilation({"file": fileNameId}));
        }
        return this.parseErrors(rawErrors);
    }

    private parseErrors(rawErrors: String[]) {
        let outputErrors: any = [];
        for (let i in rawErrors) {
            let error = rawErrors[i].split("\n");
            if (error.length == 1) continue;
            if (error.length == 2) {
                outputErrors.push({"severity": "Error", "message": error[error.length-1], "file": error[0], "length": 2, "line": 1, "column": 1});
            } else {
                const match = Array.from(error[1].matchAll(/Line ([0-9]*), col ([0-9]*):/g)); //place
                //@TODO we can determine length by ^~~~~
                outputErrors.push({"severity": "Error", "message": error[error.length-1] + "\n" + error[error.length-2], "file": error[0], "length": 2, "line": match[0][1], "column": match[0][2]});
            }
        }
        return outputErrors;
    }

    public async compileTactDocumentAndGetDiagnosticErrors(filePath: string, documentText: string) {
        if (this.isRootPathSet()) {
            const contracts = new ContractCollection();
            contracts.addContractAndResolveImports(filePath, documentText);
            const contractsForCompilation = contracts.getDefaultContractsForCompilationDiagnostics();
            const output = await this.compile(contractsForCompilation);
            if (output) {
                return output.map((error: any) => errorToDiagnostic(error));
            }
        } else {
            const contract: any = {};
            contract[filePath] = documentText;
            const output = await this.compile({ sources: contract });

            if (output) {
                return output.map((error: any) => errorToDiagnostic(error));
            }
        }
        return [];
    }

}

