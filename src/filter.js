// osascript -l JavaScript filter.js <query> <directory>: the script filter's results, as Alfred's JSON,
// from what `protonvpn status --json`, `settings --json` and `list --json` wrote into <directory>.
// Mode words in front of the query (sc, p2p, tor, random) carry through to the country you pick.

const MODES = { random: "--random", securecore: "--securecore", sc: "--securecore", p2p: "--p2p", tor: "--tor" }
const LABELS = { "--securecore": "Secure Core", "--p2p": "P2P", "--tor": "Tor", "--random": "random server" }
// A mode's countries are the ones with servers for it.
const REQUIRED = { sc: "securecore", securecore: "securecore", p2p: "p2p", tor: "tor" }
const DNS = [["proton", "Proton DNS"], ["cloudflare", "Cloudflare DNS"], ["google", "Google DNS"],
    ["opendns", "OpenDNS"], ["quad9", "Quad9 DNS"]]

// Lowercase, without accents, so "espana" finds España.
function fold(s) {
    return s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
}

// Countries for a query: code, name and alias matches first, then prefixes, then words, then substrings.
function match(query, countries) {
    const q = fold(query.trim())
    const byName = (a, b) => a.name.localeCompare(b.name)
    if (!q) return [...countries].sort(byName)
    const ranked = []
    for (const c of countries) {
        const name = fold(c.name)
        const words = name.replace(/[-&]/g, " ").split(/\s+/)
        let score
        if (q === c.code.toLowerCase() || q === name || c.aliases.includes(q)) score = 0
        else if (name.startsWith(q) || c.aliases.some(a => a.startsWith(q))) score = 1
        else if (words.some(w => w.startsWith(q))) score = 2
        else if (name.includes(q)) score = 3
        else continue
        ranked.push([score, c])
    }
    return ranked.sort((a, b) => a[0] - b[0] || byName(a[1], b[1])).map(r => r[1])
}

// The connection in a line, e.g. "Connected to CH#1 (Zurich, Switzerland), IP 1.2.3.4".
function describe(s) {
    if (s.state === "Disconnected") return "Disconnected"
    if (s.state === "Connecting") return `Connecting to ${s.server}…`
    const place = [s.city, s.country].filter(Boolean).join(", ")
    let text = s.state === "Connected" ? `Connected to ${s.server}` : `Dropped connection to ${s.server}`
    if (place) text += ` (${place})`
    if (s.ip && s.state === "Connected") text += `, IP ${s.ip}`
    if (s.port) text += `, port ${s.port}`
    return text
}

// What the workflow says as soon as a result is chosen, before the command finishes.
function notice(title) {
    title = title.replace(/ \(in use\)$/, "").replace(/…$/, "")
    if (title.startsWith("Turn ")) return `Turning ${title.slice(5)}…`
    if (title.startsWith("Use ")) return `Switching to ${title.slice(4)}…`
    const fixed = {
        "Disconnect": "Disconnecting…", "Sign out": "Signing out…", "Sign in": "Opening Terminal to sign in…",
        "Refresh WireGuard tools": "Refreshing WireGuard tools…",
    }
    if (fixed[title]) return fixed[title]
    if (title.startsWith("Copy port ")) return `Port ${title.slice(10)} copied`
    if (title.startsWith("Copy IP ")) return `IP ${title.slice(8)} copied`
    return title.endsWith("server") ? `Connecting to the ${title.toLowerCase()}…` : `Connecting to ${title}…`
}

// Commands whose title or keywords start with the query (strong), or one of their words does (weak).
function commands(query, status, settings) {
    const candidates = []
    if (status.outdated_tools) {
        candidates.push(["Refresh WireGuard tools", "Homebrew has newer versions", "setup", ["refresh", "wireguard", "setup"]])
    }
    if (status.state !== "Disconnected") {
        candidates.push(["Disconnect", describe(status), "off", ["off", "disconnect", "stop"]])
    }
    candidates.push(
        ["Sign in…", "Opens Terminal to sign in to your Proton account", "signin", ["sign in", "signin", "login", "account"]],
        ["Sign out", "Disconnects and forgets your Proton sign-in", "signout", ["sign out", "signout", "logout"]],
        ["Fastest server", "Quick Connect", "fastest", ["fastest", "quick", "connect"]],
        ["Random server", "Anywhere", "random", ["random"]],
        ["Secure Core", "Fastest Secure Core server; add a country", "sc", ["sc", "secure core"]],
        ["P2P", "Fastest P2P server; add a country", "p2p", ["p2p", "torrent"]],
        ["Tor", "Fastest Tor server; add a country", "tor", ["tor", "onion"]],
    )
    if (status.ip && status.state === "Connected") {
        candidates.push([`Copy IP ${status.ip}`, "The IP address sites see", "ip", ["ip", "copy", "address"]])
    }
    if (status.port) {
        candidates.push([`Copy port ${status.port}`, "The forwarded port", "port", ["port", "copy", "forwarded port"]])
    }
    const on = settings
    candidates.push(
        [on.netshield ? "Turn NetShield off" : "Turn NetShield on", "Proton VPN setting",
            `set netshield ${on.netshield ? "off" : "malware-ads-trackers"}`, ["netshield", "adblock", "ads"]],
        [on.kill_switch ? "Turn kill switch off" : "Turn kill switch on", "Proton VPN setting",
            `set kill-switch ${on.kill_switch ? "off" : "standard"}`, ["kill switch", "killswitch"]],
        [on.port_forwarding ? "Turn port forwarding off" : "Turn port forwarding on", "Proton VPN setting",
            `set port-forwarding ${on.port_forwarding ? "off" : "on"}`, ["port forwarding", "forwarding"]],
    )
    for (const [choice, name] of DNS) {
        candidates.push([`Use ${name}` + (choice === settings.dns ? " (in use)" : ""), "Through the VPN", `dns ${choice}`, ["dns", choice]])
    }

    const q = fold(query.trim())
    const strong = [], weak = []
    for (const [title, subtitle, arg, keywords] of candidates) {
        const result = {
            title, subtitle, arg,
            // What you'd type, e.g. "kill switch" rather than "set kill-switch off".
            autocomplete: Object.hasOwn(MODES, arg) ? arg + " "
                : arg.startsWith("set ") || arg === "signin" || arg === "setup" ? keywords[0] : arg,
            variables: { notice: notice(title) },
        }
        if (arg === "ip" || arg === "port") {
            // ⌥ shows it in large type, and ⌘ pastes it.
            const value = String(status[arg])
            result.mods = { alt: { arg: value, subtitle: `Large Type ${value}` }, cmd: { arg: value, subtitle: `Paste ${value}` } }
        }
        const names = [title.toLowerCase(), ...keywords]
        if (names.some(k => k.startsWith(q))) strong.push(result)
        else if (names.some(k => k.split(" ").some(w => w.startsWith(q)))) weak.push(result)
    }
    return [strong, weak]
}

// The results for a query; icon(code) gives a country's flag icon, if there is one.
function results(query, { status, settings, countries }, icon = () => undefined) {
    const words = query.split(/\s+/).filter(Boolean)
    const modes = []
    while (words.length && Object.hasOwn(MODES, words[0].toLowerCase())) modes.push(words.shift().toLowerCase())
    query = words.join(" ")
    const prefix = modes.join(" ")
    const note = modes.map(m => LABELS[MODES[m]]).join(", ")

    const items = []
    let weak = []
    if (query && !modes.length) {
        const [strong, rest] = commands(query, status, settings)
        items.push(...strong)
        weak = rest
    }
    for (const mode of modes) {
        if (REQUIRED[mode]) countries = countries.filter(c => c.features.includes(REQUIRED[mode]))
    }
    if (!query && !modes.length) {
        items.push({ title: describe(status), subtitle: "Proton VPN", valid: false, icon: icon(status.code) })
        // Up top while Homebrew has newer WireGuard tools than the copies setup made.
        items.push(...commands("refresh", status, settings)[0].filter(r => r.arg === "setup"))
        if (status.state !== "Disconnected") items.push({ title: "Disconnect", arg: "off", autocomplete: "off" })
        items.push(
            { title: "Fastest server", subtitle: "Quick Connect", arg: "fastest", autocomplete: "fastest" },
            { title: "Random server", subtitle: "Anywhere", arg: "random", autocomplete: "random " },
            { title: "Secure Core", subtitle: "Fastest Secure Core server; add a country", arg: "sc", autocomplete: "sc " },
        )
    } else if (!query) {
        items.push({ title: `Fastest server (${note})`, arg: prefix, autocomplete: prefix + " ",
            variables: { notice: `Connecting to the fastest server (${note})…` } })
    }
    // A mode on its own also lists its countries, to pick one.
    for (const c of query || modes.length ? match(query, countries) : []) {
        const label = c.name + (note ? ` (${note})` : "")
        items.push({
            uid: `${prefix} ${c.code}`.trim(),
            title: label,
            subtitle: `${c.code} · ${c.servers} servers`,
            arg: `${prefix} ${c.code}`.trim(),
            autocomplete: `${prefix} ${c.name}`.trim(),
            icon: icon(c.code),
            variables: { notice: `Connecting to ${label}…` },
        })
    }
    items.push(...weak)
    for (const item of items) {
        if (!item.icon) delete item.icon
        // Without its own, Alfred offers to search Finder for the result under ⌥ and ⌘.
        item.mods = item.mods || { alt: { valid: false, subtitle: item.subtitle || "" }, cmd: { valid: false, subtitle: item.subtitle || "" } }
    }
    return { items }
}

/* node:coverage disable */
// Under osascript, which reads the files and draws the flags; the tests call results instead.
function run(argv) {
    ObjC.import("Foundation")
    const [query, directory] = argv
    const read = name => JSON.parse($.NSString.stringWithContentsOfFileEncodingError(`${directory}/${name}.json`, $.NSUTF8StringEncoding, $()).js)
    const flags = `${$.NSProcessInfo.processInfo.environment.objectForKey("alfred_workflow_cache").js}/flags`
    const icon = code => {
        const path = `${flags}/${code}.png`
        return code && $.NSFileManager.defaultManager.fileExistsAtPath(path) ? { path } : undefined
    }
    return JSON.stringify(results(query || "", { status: read("status"), settings: read("settings"), countries: read("countries") }, icon))
}
/* node:coverage enable */

if (typeof module !== "undefined") module.exports = { fold, match, describe, notice, commands, results }
