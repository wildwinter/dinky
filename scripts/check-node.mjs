// Verify the minimum Node.js version required to build Dinky.
// Replaces check-node-version, which doesn't work reliably on Windows.
const required = { major: 22, minor: 12 };
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < required.major || (major === required.major && minor < required.minor)) {
    console.error(
        `Error: Node.js >= ${required.major}.${required.minor} is required, ` +
        `but the current version is ${process.versions.node}.`
    );
    process.exit(1);
}
