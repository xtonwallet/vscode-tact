'use strict';
import * as fs from 'fs';
import * as path from 'path';
import {
    createConnection, Connection,
    TextDocuments, InitializeResult, Hover,
    ProposedFeatures,
    Files, Diagnostic, TextDocumentPositionParams,
    CompletionItem, Location,
    TextDocumentSyncKind, HoverParams, MarkupContent
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompilerError } from './tactErrorsToDiagnostics';
import { CompletionService } from './completionService';
import { TactDefinitionProvider } from './definitionProvider';
import { HoverService } from './hoverService';
import { TactCompiler } from './tactCompiler';

interface Settings {
    tact: TactSettings;
}

interface TactSettings {
    // option for backward compatibilities, please use "linter" option instead
    linter: boolean | string;
    enabledAsYouTypeCompilationErrorCheck: boolean;
    defaultCompiler: string;
    compileUsingLocalVersion: string;
    validationDelay: number;
}

// import * as path from 'path';
// Create a connection for the server
const connection: Connection = createConnection(ProposedFeatures.all);

console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let rootPath: string | undefined;
let tactCompiler: TactCompiler;

let enabledAsYouTypeErrorCheck = false;
let validationDelay = 1500;

// flags to avoid trigger concurrent validations (compiling is slow)
let validatingDocument = false;
let validatingAllDocuments = false;

async function validate(document: TextDocument) {
    try {
        validatingDocument = true;
        const uri = document.uri;
        const filePath = Files.uriToFilePath(uri) ?? "";

        const documentText = document.getText();
        const compileErrorDiagnostics: Diagnostic[] = [];

        try {
            if (enabledAsYouTypeErrorCheck) {
                const errors: CompilerError[] = await tactCompiler
                    .compileTactDocumentAndGetDiagnosticErrors(filePath, documentText);
                errors.forEach(errorItem => {
                    if (path.normalize(errorItem.fileName) === path.normalize(filePath)) {
                        compileErrorDiagnostics.push(errorItem.diagnostic);
                    }
                });
            }
        } catch (e) {
            //console.log(JSON.stringify(e));
        }

        const diagnostics = compileErrorDiagnostics;
        connection.sendDiagnostics({diagnostics, uri});
    } finally {
        validatingDocument = false;
    }
}

// This handler provides the initial list of the completion items.
connection.onCompletion((textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    let completionItems: CompletionItem[] = [];
    const document = documents.get(textDocumentPosition.textDocument.uri);
    const service = new CompletionService(rootPath);

    completionItems = completionItems.concat(
        service.getAllCompletionItems( document,
                                        textDocumentPosition.position,
                                        )
    );
    return completionItems;
});

connection.onHover((textPosition: HoverParams): Hover => {
    const hoverService = new HoverService(rootPath);
    const suggestion = hoverService.getHoverItems(
        documents.get(textPosition.textDocument.uri),
        textPosition.position);
    //console.log(JSON.stringify(suggestion));
    let doc: MarkupContent = suggestion
    return {
      contents: doc
    }
});

connection.onDefinition((handler: TextDocumentPositionParams): Thenable<Location | Location[] | undefined> | undefined => {
    const provider = new TactDefinitionProvider(rootPath);
    return provider.provideDefinition(documents.get(handler.textDocument.uri) as TextDocument, handler.position);
});

// This handler resolve additional information for the item selected in
// the completion list.
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
//   item.
// });
function validateAllDocuments() {
    if (!validatingAllDocuments) {
        try {
            validatingAllDocuments = true;
            documents.all().forEach(document => validate(document));
        } finally {
            validatingAllDocuments = false;
        }
    }
}

function startValidation() {
    if (enabledAsYouTypeErrorCheck) {
        validateAllDocuments();
    } else {
        //console.log('error check on typing is disabled');
    }
}

documents.onDidOpen(event => {
    const document = event.document;
    if (!validatingDocument && !validatingAllDocuments) {
        validate(document);
    }
});

/*
// Here issue with the previous content on the FS
// Can be resolved by creating a temporary file
documents.onDidChangeContent(event => {
    const document = event.document;

    if (!validatingDocument && !validatingAllDocuments) {
        validatingDocument = true; // control the flag at a higher level

        // slow down, give enough time to type (1.5 seconds?)
        setTimeout(() =>  validate(document), validationDelay);
    }
});
*/

documents.onDidSave(event => {
    const document = event.document;
    if (!validatingDocument && !validatingAllDocuments) {
        validatingDocument = true; // control the flag at a higher level
        // slow down, give enough time to type (1.5 seconds?)
        setTimeout(() =>  validate(document), validationDelay);
    }
});

// remove diagnostics from the Problems panel when we close the file
documents.onDidClose(event => {
    connection.sendDiagnostics({
        diagnostics: [],
        uri: event.document.uri,
    });
});

connection.onInitialize((result): InitializeResult => {
    if (result.workspaceFolders != undefined && result.workspaceFolders?.length > 0) {
        rootPath = Files.uriToFilePath(result.workspaceFolders[0].uri);
    }
    
    tactCompiler = new TactCompiler(rootPath ?? "");

    return {
        capabilities: {
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: [ '.' ],
            },
            hoverProvider: true,
            definitionProvider: true,
            textDocumentSync: TextDocumentSyncKind.Full,
        },
    };
});

connection.onInitialized(() => {
    console.log('Tact language server is created.');
});

connection.onDidChangeConfiguration((change) => {
    const settings = <Settings>change.settings;
    enabledAsYouTypeErrorCheck = settings.tact.enabledAsYouTypeCompilationErrorCheck;
    validationDelay = settings.tact.validationDelay;

    startValidation();
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
