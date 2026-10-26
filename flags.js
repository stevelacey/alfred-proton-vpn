// osascript -l JavaScript flags.js <directory> < codes: draws each country code's flag emoji
// (one code per line on stdin) into <directory>/<code>.png, for the results' icons.
ObjC.import("AppKit")
ObjC.import("Foundation")

function run(argv) {
    const directory = argv[0]
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(directory, true, $(), $())
    const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js
    const size = 128
    for (const code of input.split(/\s+/).filter(c => /^[A-Z]{2}$/.test(c))) {
        // Proton uses UK where the regional indicators (and ISO) use GB.
        const iso = code === "UK" ? "GB" : code
        const flag = String.fromCodePoint(...[...iso].map(c => 127397 + c.charCodeAt(0)))
        const attributes = $.NSDictionary.dictionaryWithObjectForKey($.NSFont.systemFontOfSize(size * 0.8), $.NSFontAttributeName)
        const text = $(flag)
        const bounds = text.sizeWithAttributes(attributes)
        const image = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size))
        image.lockFocus
        text.drawAtPointWithAttributes($.NSMakePoint((size - bounds.width) / 2, (size - bounds.height) / 2), attributes)
        image.unlockFocus
        const png = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
        png.writeToFileAtomically(`${directory}/${code}.png`, true)
    }
}
