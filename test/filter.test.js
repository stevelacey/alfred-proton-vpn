const assert = require("node:assert/strict")
const { test } = require("node:test")
const { fold, match, describe, notice, commands, results } = require("../src/filter.js")

const countries = [
    { code: "CH", name: "Switzerland", servers: 3, aliases: ["swiss"], features: ["p2p", "securecore", "streaming"] },
    { code: "ES", name: "Spain", servers: 2, aliases: ["espana"], features: ["securecore"] },
    { code: "SE", name: "Sweden", servers: 1, aliases: [], features: ["tor"] },
    { code: "US", name: "United States", servers: 2, aliases: ["usa"], features: [] },
    { code: "BA", name: "Bosnia & Herzegovina", servers: 1, aliases: [], features: [] },
]
const disconnected = { state: "Disconnected" }
const connected = { state: "Connected", server: "CH#1", code: "CH", country: "Switzerland", city: "Zurich", ip: "1.2.3.4", port: 4242 }
const settings = { netshield: 1, kill_switch: 0, port_forwarding: true, dns: "google" }
const data = (status = disconnected) => ({ status, settings, countries })
const titles = r => r.items.map(i => i.title)

test("fold lowercases and drops accents", () => {
    assert.equal(fold("España"), "espana")
})

test("match ranks codes, names and aliases, then prefixes, words and substrings", () => {
    const names = q => match(q, countries).map(c => c.code)
    assert.deepEqual(names(""), ["BA", "ES", "SE", "CH", "US"])
    assert.deepEqual(names("ch"), ["CH"])
    assert.deepEqual(names("swiss"), ["CH"])
    assert.deepEqual(names("sw"), ["SE", "CH"])
    assert.deepEqual(names("us"), ["US"])
    assert.deepEqual(names("herz"), ["BA"])
    assert.deepEqual(names("eden"), ["SE"])
    assert.deepEqual(names("España"), ["ES"])
    assert.deepEqual(names("zz"), [])
})

test("describe says what the connection is", () => {
    assert.equal(describe(disconnected), "Disconnected")
    assert.equal(describe({ state: "Connecting", server: "CH#1" }), "Connecting to CH#1…")
    assert.equal(describe(connected), "Connected to CH#1 (Zurich, Switzerland), IP 1.2.3.4, port 4242")
    assert.equal(describe({ state: "Dropped", server: "CH#1", ip: "1.2.3.4" }), "Dropped connection to CH#1")
})

test("notice says what's happening", () => {
    const cases = {
        "Turn NetShield off": "Turning NetShield off…", "Use Google DNS (in use)": "Switching to Google DNS…",
        "Disconnect": "Disconnecting…", "Sign out": "Signing out…", "Sign in…": "Opening Terminal to sign in…",
        "Refresh WireGuard tools": "Refreshing WireGuard tools…", "Copy port 4242": "Port 4242 copied",
        "Copy IP 1.2.3.4": "IP 1.2.3.4 copied", "Fastest server": "Connecting to the fastest server…",
        "P2P": "Connecting to P2P…",
    }
    for (const [title, said] of Object.entries(cases)) assert.equal(notice(title), said)
})

test("commands match by title or keyword, then by a word", () => {
    const [strong, weak] = commands("kill", disconnected, settings)
    assert.deepEqual(strong.map(r => r.title), ["Turn kill switch on"])
    assert.equal(strong[0].arg, "set kill-switch standard")
    assert.equal(strong[0].autocomplete, "kill switch")
    assert.deepEqual(weak, [])
    const [, words] = commands("switch", disconnected, settings)
    assert.deepEqual(words.map(r => r.title), ["Turn kill switch on"])
})

test("commands follow the connection and settings", () => {
    const all = (status, on) => commands("", status, on)[0]
    const off = all(disconnected, { netshield: 0, kill_switch: 1, port_forwarding: false, dns: "proton" })
    assert.ok(!off.some(r => r.title === "Disconnect" || r.title.startsWith("Copy")))
    assert.deepEqual(off.filter(r => r.arg.startsWith("set ")).map(r => r.arg),
        ["set netshield malware-ads-trackers", "set kill-switch off", "set port-forwarding on"])
    assert.ok(off.some(r => r.title === "Use Proton DNS (in use)"))
    const on = all(connected, settings)
    assert.equal(on.find(r => r.arg === "off").subtitle, describe(connected))
    assert.deepEqual(on.filter(r => r.arg.startsWith("set ")).map(r => r.arg),
        ["set netshield off", "set kill-switch standard", "set port-forwarding off"])
    assert.ok(on.some(r => r.title === "Use Google DNS (in use)"))
})

test("copying the IP or port shows it large with ⌥ and pastes it with ⌘", () => {
    const [strong] = commands("copy", connected, settings)
    assert.deepEqual(strong.map(r => r.title), ["Copy IP 1.2.3.4", "Copy port 4242"])
    assert.deepEqual(strong[1].mods, { alt: { arg: "4242", subtitle: "Large Type 4242" }, cmd: { arg: "4242", subtitle: "Paste 4242" } })
    assert.deepEqual(strong[1].variables, { notice: "Port 4242 copied" })
    // Only while connected.
    assert.deepEqual(commands("ip", { state: "Dropped", ip: "1.2.3.4" }, settings)[0].map(r => r.arg), [])
})

test("sign in, setup and modes autocomplete with what you'd type", () => {
    const status = { ...disconnected, outdated_tools: ["bash"] }
    const byArg = Object.fromEntries(commands("", status, settings)[0].map(r => [r.arg, r.autocomplete]))
    assert.equal(byArg.signin, "sign in")
    assert.equal(byArg.setup, "refresh")
    assert.equal(byArg.random, "random ")
    assert.equal(byArg.fastest, "fastest")
})

test("nothing typed: the connection, then quick picks", () => {
    const r = results("", data(connected), code => code && { path: `${code}.png` })
    assert.deepEqual(titles(r), [describe(connected), "Disconnect", "Fastest server", "Random server", "Secure Core"])
    assert.deepEqual(r.items[0].icon, { path: "CH.png" })
    assert.equal(r.items[0].valid, false)
    assert.ok(!("icon" in r.items[1]))
    // Without its own, ⌥ and ⌘ just show the subtitle.
    assert.deepEqual(r.items[2].mods, { alt: { valid: false, subtitle: "Quick Connect" }, cmd: { valid: false, subtitle: "Quick Connect" } })
    assert.deepEqual(r.items[1].mods.alt, { valid: false, subtitle: "" })
    assert.deepEqual(titles(results("", data())), ["Disconnected", "Fastest server", "Random server", "Secure Core"])
})

test("nothing typed, with newer WireGuard tools: refreshing them comes second", () => {
    const r = results("", data({ ...disconnected, outdated_tools: ["bash"] }))
    assert.deepEqual(titles(r).slice(0, 2), ["Disconnected", "Refresh WireGuard tools"])
    assert.equal(r.items[1].arg, "setup")
})

test("a query lists matching commands, then countries, then commands matching a word", () => {
    const r = results("s", data(), code => ({ path: `${code}.png` }))
    assert.deepEqual(titles(r), ["Sign in…", "Sign out", "Secure Core", "Spain", "Sweden", "Switzerland", "United States",
        "Bosnia & Herzegovina", "Fastest server", "Random server", "Turn kill switch on"])
    const sweden = r.items[4]
    assert.equal(sweden.uid, "SE")
    assert.equal(sweden.subtitle, "SE · 1 servers")
    assert.equal(sweden.arg, "SE")
    assert.equal(sweden.autocomplete, "Sweden")
    assert.deepEqual(sweden.icon, { path: "SE.png" })
    assert.deepEqual(sweden.variables, { notice: "Connecting to Sweden…" })
})

test("a mode lists the countries with servers for it, and carries through", () => {
    const r = results("sc", data())
    assert.deepEqual(titles(r), ["Fastest server (Secure Core)", "Spain (Secure Core)", "Switzerland (Secure Core)"])
    assert.equal(r.items[0].arg, "sc")
    assert.equal(r.items[0].autocomplete, "sc ")
    assert.deepEqual(r.items[0].variables, { notice: "Connecting to the fastest server (Secure Core)…" })
    const picked = results("P2P random swi", data()).items
    assert.deepEqual(picked.map(i => [i.title, i.arg, i.autocomplete, i.uid]),
        [["Switzerland (P2P, random server)", "p2p random CH", "p2p random Switzerland", "p2p random CH"]])
    assert.deepEqual(picked[0].variables, { notice: "Connecting to Switzerland (P2P, random server)…" })
    // Random needs nothing, so every country has servers for it.
    assert.equal(results("random", data()).items.length, countries.length + 1)
})

test("a word that's only a mode's name inherited from Object isn't one", () => {
    assert.deepEqual(titles(results("constructor", data())), [])
})
