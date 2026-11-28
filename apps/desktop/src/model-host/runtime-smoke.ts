import { proveRuntimes } from "@pochimail/ai/runtime-smoke";

// Runs inside Electron's utilityProcess, only in the packaging smoke test (M3): the native runtimes of the local models must
// load from the packaged app, in the process type that will host them. No model file is needed.
void proveRuntimes().then((proof) => process.parentPort.postMessage(proof));
