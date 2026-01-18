const regex = /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\))?(\s*)(:)(\s*)(\(.*?\))?(\s*)(.*)$/;

const tests = [
    "NAME: Text",
    "NAME : Text",
    "NAME (qual): Text",
    "NAME (qual): (dir) Text",
    "NAME: (dir) Text",
    "NAME : (dir) Text",
    "NAME(qual):Text",
];

tests.forEach(t => {
    const match = t.match(regex);
    console.log(`'${t}': ${match ? 'MATCH' : 'FAIL'}`);
    if (match) {
        // Check group count
        // 0 is full match. 1-10 are groups.
        // console.log(match); 
        // We expect match[1]..match[10] to allow undefined for optionals? 
        // In JS match output, missing optionals are undefined.
        // Check if indices 1-10 exist (can be undefined, but length should be sufficient)
    }
});
