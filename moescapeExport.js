// ==UserScript==
// @name         Moescape Lorebook Bulk Export
// @namespace    local.moescape.lorebook.export
// @author       etriptow
// @version      1.3.0
// @description  Explicitly load every lorebook entry; export entries and lorebook metadata in five formats.
// @match        https://moescape.ai/tavern/lorebooks/*
// @match        https://www.moescape.ai/tavern/lorebooks/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=moescape.ai
// @run-at       document-idle
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/600422/Moescape%20Lorebook%20Bulk%20Export.user.js
// @updateURL https://update.greasyfork.org/scripts/600422/Moescape%20Lorebook%20Bulk%20Export.meta.js
// ==/UserScript==

(() => {
    'use strict';

    // based on XPaths. No network requests, edits, or uploads.
    const ROOT = '/html/body/main/section/div/div[2]/div/div/div/div';
    const MAIN = ROOT + '[2]';
    const SIDE = ROOT + '[1]';
    const PATH = {
        name: MAIN + '/div[1]/div[1]/h1',
        author: MAIN + '/div[1]/div[2]/a',
        image: SIDE + '/div[1]/div[1]/img',
        description: MAIN + '/div[2]/div[1]/div[1]/div/p',
        tags: MAIN + '/div[2]/div[1]/div[2]/div/div',
        tagsMore: MAIN + '/div[2]/div[1]/div[2]/div/button',
        count: MAIN + '/div[2]/div[1]/div[3]/p[2]',
        list: MAIN + '/div[2]/div[1]/div[4]',
        detail: MAIN + '/div[2]/div[2]',
        title: MAIN + '/div[2]/div[2]/div/p',
        keyBox: MAIN + '/div[2]/div[2]/div/div[2]/div[3]',
        descriptionCandidates: MAIN + '/div[2]/div[2]/div/div[*]/div',
        likes: SIDE + '/div[2]/div[2]/div[1]/p[2]',
        updated: SIDE + '/div[2]/div[2]/div[2]/p[2]',
        created: SIDE + '/div[2]/div[2]/div[3]/p[2]',
        scanDepth: SIDE + '/div[2]/div[2]/div[4]/p[2]',
        recursiveDepth: SIDE + '/div[2]/div[2]/div[5]/p[2]'
    };

    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const text = node => (node?.innerText ?? node?.textContent ?? '').replace(/\r\n?/g, '\n');
    const trim = node => text(node).trim();
    const xp = path => document.evaluate(
        path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue;
    const xpAll = path => {
        const items = document.evaluate(
            path, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        return Array.from({ length: items.snapshotLength }, (_, i) => items.snapshotItem(i));
    };
    const selectedTitle = () => trim(xp(PATH.title));
    const sleepUntil = async (predicate, timeout = 5000) => {
        const start = performance.now();
        do {
            if (predicate()) return true;
            await pause(120);
        } while (performance.now() - start < timeout);
        return !!predicate();
    };

    // get ## from (## entries)
    function expectedCount() {
        const raw = trim(xp(PATH.count));
        const match = raw.match(/\(?\s*([\d,]+)\s+entr(?:y|ies)\b/i);
        return match ? Number(match[1].replaceAll(',', '')) : null;
    }

    function entryRows() {
        const list = xp(PATH.list);
        if (!list) return [];
        return [...list.children].map((row, index) => {
            const p = row.querySelector(':scope > div:first-child > p');
            const name = trim(p);
            if (!p || !name || /^(?:(?:\+|create|add|new)\s*)*(?:new\s+)?entry$/i.test(name)) return null;
            return { row, index, title: name };
        }).filter(Boolean);
    }

    // click sim > load more
    function loadMoreButton() {
        const list = xp(PATH.list);
        if (!list) return null;
        const buttons = [...list.querySelectorAll(':scope > div > button')];
        const enabled = buttons.filter(b => !b.disabled && b.getAttribute('aria-disabled') !== 'true');
        const named = enabled.find(b =>
                                   /\b(load\s*more|show\s*more|view\s*more|more\s+entries)\b/i.test(
            [trim(b), b.getAttribute('aria-label'), b.getAttribute('title')].filter(Boolean).join(' ')
        )
                                  );
        if (named) return named;
        // the Load More XPath is a direct button child of a list div
        // fall back only if the LAST such row contains no entry title
        const lastRow = list.lastElementChild;
        const fallback = lastRow?.querySelector(':scope > button');
        if (fallback && !fallback.disabled && !lastRow.querySelector(':scope > div:first-child > p')) {
            return fallback;
        }
        return null;
    }

    // scroll scroll
    const scrollerOf = node => {
        for (let n = node; n && n !== document.body; n = n.parentElement) {
            const style = getComputedStyle(n);
            if (/(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 10) return n;
        }
        return null;
    };
    const readScroll = scroller => scroller ? scroller.scrollTop : window.scrollY;
    const setScroll = (scroller, value) => {
        if (scroller) scroller.scrollTop = value;
        else window.scrollTo({ top: value, behavior: 'instant' });
    };

    // get lorebook meta
    function lorebookMetadata() {
        const img = xp(PATH.image);
        const src = img?.getAttribute('data-src') || img?.getAttribute('src') || img?.currentSrc || '';
        let imageUrl = src;
        if (src) {
            try { imageUrl = new URL(src, location.href).href; } catch (_) { /* keep raw */ }
        }
        const descriptionParagraphs = xpAll(PATH.description).map(trim);
        return {
            name: trim(xp(PATH.name)),
            author: trim(xp(PATH.author)).replace(/^by\s+/i, ''),
            imageUrl,
            description: descriptionParagraphs.join('\n\n'),
            descriptionParagraphs,
            tags: [...new Set(xpAll(PATH.tags).map(trim).filter(Boolean))],
            likes: trim(xp(PATH.likes)),
            updated: trim(xp(PATH.updated)),
            created: trim(xp(PATH.created)),
            scanDepth: trim(xp(PATH.scanDepth)),
            recursiveDepth: trim(xp(PATH.recursiveDepth))
        };
    }

    // this doesn't work great, need to revise to LOOK for the expand -- as is, loads visible tags
    async function expandTags() {
        for (let i = 0; i < 25 && !stopped; i++) {
            const button = xp(PATH.tagsMore);
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
            const label = [trim(button), button.getAttribute('aria-label'), button.getAttribute('title')]
            .filter(Boolean).join(' ');
            if (/\b(show\s*less|collapse|hide\s*tags)\b/i.test(label)) return;
            const before = xpAll(PATH.tags).length;
            button.click();
            await sleepUntil(() => xpAll(PATH.tags).length > before || xp(PATH.tagsMore) !== button, 1500);
            await pause(70);
            if (xpAll(PATH.tags).length <= before) return;
        }
    }

    function description() {
        const detail = xp(PATH.detail);
        const keys = xp(PATH.keyBox);
        if (!detail) return { value: '', found: false, source: '(detail missing)' };
        const outsideKeys = node => !keys || (!node.contains(keys) && !keys.contains(node));
        const candidates = xpAll(PATH.descriptionCandidates).filter(node =>
                                                                    node instanceof HTMLElement && outsideKeys(node)
                                                                   );
        for (const editor of detail.querySelectorAll('textarea, [contenteditable="true"], .ProseMirror')) {
            if (outsideKeys(editor) && !candidates.some(node => node === editor || node.contains(editor))) {
                candidates.push(editor);
            }
        }
        const options = candidates.map(node => {
            const editor = node.matches('textarea, [contenteditable="true"], .ProseMirror')
            ? node : node.querySelector('textarea, [contenteditable="true"], .ProseMirror');
            const target = editor || node;
            const value = target instanceof HTMLTextAreaElement ? target.value.replace(/\r\n?/g, '\n') : text(target);
            let score = value.trim().length;
            if (editor) score += 100000;
            if (/^(description|content|summary description)$/i.test(value.trim())) score -= 50000;
            return { value, score, source: editor ? 'editable field' : 'text node' };
        }).filter(x => x.value.trim()).sort((a, b) => b.score - a.score);
        return { value: options[0]?.value ?? '', found: !!options[0], source: options[0]?.source || '(none)' };
    }

    function activationKeys() {
        const box = xp(PATH.keyBox);
        if (!box) return { values: [], found: false };
        const values = [];
        for (const chip of box.children) {
            if (chip.matches('textarea, input') || chip.querySelector('textarea, input')) continue;
            const copy = chip.cloneNode(true);
            copy.querySelectorAll(
                'svg, button, input, textarea, [aria-label*="remove" i], ' +
                '[title*="remove" i], [aria-label*="delete" i]'
            ).forEach(node => node.remove());
            const key = trim(copy).replace(/^[×✕]\s*|\s*[×✕]$/g, '').trim();
            if (key && !/^(add|add key|add keyword|new keyword|\+)$/i.test(key)) values.push(key);
        }
        return { values, found: true };
    }

    function selectedEntry(expectedTitle = '') {
        const desc = description();
        const keys = activationKeys();
        return {
            title: selectedTitle() || expectedTitle,
            description: desc.value,
            activationKeys: keys.values,
            descriptionChars: desc.value.length,
            activationKeysChars: keys.values.join(', ').length,
            _diagnostics: { descriptionFound: desc.found, keyContainerFound: keys.found, source: desc.source }
        };
    }

    // all entries are loaded *before* content extraction, a missing batch is fatal

    async function preloadEntries(total) {
        if (total === null || !Number.isSafeInteger(total) || total < 1) {
            throw new Error(
                'Entry count unavailable. Check the count XPath before scanning.'
            );
        }

        // small lorebooks (1–25 entries):
        // no pagination or "Load more" required
        if (total <= 25) {
            status(`Small lorebook detected: ${total} entries.\nLoading entries…`);

            // allow time for React to finish rendering the list
            await sleepUntil(() => entryRows().length === total, 5000);

            if (stopped) {
                throw new Error('Stopped by user.');
            }

            const loaded = entryRows().length;

            if (loaded !== total) {
                throw new Error(
                    `Entry count mismatch: expected ${total}, found ${loaded}. ` +
                    'Check the entry list XPath.'
                );
            }

            status(`All ${total} entries loaded. Starting extraction…`);
            return;
        }

        // large lorebooks (26+ entries):
        // explicitly paginate using "Load more".
        let lastCount = -1;
        let failures = 0;
        const clickLimit = Math.max(40, total * 2);

        for (let attempt = 0; attempt < clickLimit && !stopped; attempt++) {
            const count = entryRows().length;

            status(
                `Loading entries: ${count} / ${total}\nLooking for Load more…`
            );

            if (count === total) return;

            if (count > total) {
                throw new Error(
                    `Detected ${count} title rows but expected ${total}. ` +
                    'Check list selector.'
                );
            }

            const button = loadMoreButton();

            if (!button) {
                const appeared = await sleepUntil(
                    () => !!loadMoreButton() || entryRows().length > count,
                    3500
                );

                if (appeared) continue;

                throw new Error(
                    `Only ${count}/${total} entries loaded. ` +
                    'No Load more button found; scan NOT started.'
                );
            }

            try {
                button.scrollIntoView({
                    block: 'center',
                    behavior: 'instant'
                });
            } catch (_) {
                // optional scrolling.
            }

            button.click();

            const grew = await sleepUntil(
                () => entryRows().length > count,
                6500
            );

            const now = entryRows().length;

            if (!grew || now === lastCount) {
                failures++;
            } else {
                failures = 0;
            }

            lastCount = now;

            if (failures >= 3) {
                throw new Error(
                    `Load more stopped working at ${now}/${total}. ` +
                    'Scan NOT started.'
                );
            }
        }

        if (stopped) {
            throw new Error('Stopped by user during preload.');
        }

        throw new Error(
            `Preload safety limit reached at ` +
            `${entryRows().length}/${total}.`
        );
    }


    const host = document.createElement('div');
    host.id = 'moescape-bulk-export';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
    <style>
      * {box-sizing:border-box}
      .panel {width:370px;max-width:calc(100vw - 22px);background:#15202b;
        color:#f1f5f9;padding:13px;border:1px solid #64748b;border-radius:11px;
        font:13px/1.45 system-ui,Segoe UI,sans-serif;box-shadow:0 10px 32px #0007}
      .top {display:flex;justify-content:space-between;align-items:center;gap:8px}
      .top strong {font-size:14px}
      #count {color:#a7f3d0;font-weight:normal}
      .inner {margin-top:10px}
      .panel.collapsed .inner {display:none}
      label {display:block;color:#cbd5e1;margin:8px 0 3px}
      input,select {width:100%;padding:7px 8px;color:#fff;border:1px solid #64748b;
        border-radius:6px;background:#0f172a;font:inherit}
      .buttons {display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
      button {background:#334155;border:1px solid #64748b;color:white;
        padding:7px 9px;border-radius:6px;cursor:pointer;font:inherit}
      button.primary {background:#0f766e;border-color:#14b8a6;font-weight:700}
      button:disabled {opacity:.4;cursor:not-allowed}
      #toggle {padding:1px 8px;font-size:18px;min-width:31px;line-height:1.2}
      #status,#warnings {white-space:pre-wrap;max-height:120px;overflow:auto;
        margin-top:8px;font-size:12px}
      #status {color:#d1fae5}
      #warnings {color:#fbbf24}
      p {margin:3px 0 6px;color:#cbd5e1}
    </style>
    <div class="panel" id="panel">
      <div class="top">
        <strong>Moescape Lorebook Exporter <span id="count"></span></strong>
        <button id="toggle" type="button" title="Minimize or restore exporter">−</button>
      </div>
      <div class="inner">
        <p>Read-only. Loads every entry before extraction.</p>
        <label for="bookName" title="Taken from the lorebook heading. Editable here for filenames only.">Lorebook name ⓘ</label>
        <input id="bookName" type="text" placeholder="Reading lorebook heading…"
          title="From the lorebook h1. Changes here affect only downloaded filenames." />
        <div class="buttons">
          <button id="preview" title="Check the selected entry before running a full scan">Preview selection</button>
          <button id="scan" class="primary" title="Click Load more repeatedly until all entries are loaded, then capture each entry">Scan all entries</button>
          <button id="stop" disabled title="Stop loading or extracting entries">Stop</button>
        </div>
        <label for="format" title="JSON is recommended for full-fidelity reconciliation. Other formats are provided for interoperability.">Download format ⓘ</label>
        <select id="format" title="Choose the export format">
          <option value="JSON">JSON</option>
          <option value="JSONL">JSONL</option>
          <option value="CSV">CSV</option>
          <option value="TXT">TXT</option>
          <option value="XML">XML</option>
          <option value="IMPORT_JSON">Import JSON (C.AI-compatible schema)</option>
        </select>
        <div id="importOptions" style="display:none;margin-top:8px">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;margin:0"
            title="Character.AI allows only 8 keywords per entry. Enable to keep just the first 8. Leave unchecked to preserve all keys for sites such as Moescape.">
            <input id="limitKeys" type="checkbox" style="width:auto;margin:3px 0 0" />
            <span>Limit to 8 keys per entry (strict Character.AI mode) ⓘ</span>
          </label>
          <p style="margin-top:5px">Unchecked: preserves ALL keys, including for Moescape imports.
            Checked: keeps the first 8 keys; additional keys are omitted from this file only.</p>
        </div>
        <div class="buttons">
          <button id="download" class="primary" disabled title="Download the scanned lorebook. An incomplete scan is explicitly marked in the file.">Download export</button>
        </div>
        <div id="status">Ready. Select an entry to preview, or run a scan.</div>
        <div id="warnings"></div>
      </div>
    </div>`;

    const $ = id => shadow.getElementById(id);
    const status = value => { $('status').textContent = value; };
    let manualFilename = false;
    let metadata = {};
    let entries = [];
    let expected = null;
    let warnings = [];
    let started = '';
    let complete = false;
    let busy = false;
    let stopped = false;

    const warning = message => {
        warnings.push(message);
        $('warnings').textContent = warnings.slice(-6).join('\n');
        console.warn('[Lorebook Export]', message);
    };

    const refreshHeader = () => {
        const name = trim(xp(PATH.name));
        if (!manualFilename && name) $('bookName').value = name;
        const count = expectedCount();
        $('count').textContent = count === null ? '(count unavailable)' : `(${count} entries)`;
        return { name, count };
    };
    $('bookName').addEventListener('input', () => { manualFilename = true; });
    $('format').addEventListener('change', () => {
        $('importOptions').style.display = $('format').value === 'IMPORT_JSON' ? 'block' : 'none';
    });
    $('toggle').onclick = () => {
        const collapsed = $('panel').classList.toggle('collapsed');
        $('toggle').textContent = collapsed ? '+' : '−';
    };
    $('stop').onclick = () => { stopped = true; status('Stopping…'); };
    refreshHeader();
    // React may populate the heading after the userscript starts.
    let headerChecks = 0;
    const headerTimer = setInterval(() => {
        refreshHeader();
        if (trim(xp(PATH.name)) && expectedCount() !== null || ++headerChecks >= 45) clearInterval(headerTimer);
    }, 400);

    $('preview').onclick = () => {
        refreshHeader();
        if (!xp(PATH.detail)) return status('Entry detail XPath not found. Open the lorebook editor.');
        const entry = selectedEntry();
        status(`Lorebook: ${trim(xp(PATH.name)) || '(heading missing)'}\n` +
               `Selected: ${entry.title || '(none)'}\nDescription: ${entry.descriptionChars} chars\n` +
               `Keys: ${entry.activationKeys.length} (${entry.activationKeysChars} chars)\n` +
               `Source: ${entry._diagnostics.source}`);
        console.log('[Lorebook Export] Preview:', entry, 'Metadata:', lorebookMetadata());
    };

    $('scan').onclick = async () => {
        if (busy) return;
        busy = true;
        stopped = false;
        entries = [];
        warnings = [];
        complete = false;
        started = new Date().toISOString();
        $('warnings').textContent = '';
        $('scan').disabled = $('preview').disabled = true;
        $('stop').disabled = false;
        $('download').disabled = true;
        const scroller = scrollerOf(xp(PATH.list));
        const initialScroll = readScroll(scroller);
        try {
            const info = refreshHeader();
            expected = info.count;
            if (!info.name) throw new Error('Lorebook heading not found at the supplied XPath.');
            if (!xp(PATH.list) || !xp(PATH.detail)) throw new Error('Entry list/detail not found; open the editor.');

            // issue 2: do not scan just the initial 25 entries.
            await preloadEntries(expected);
            if (stopped) throw new Error('Stopped by user.');
            if (entryRows().length !== expected) throw new Error('Preload count changed unexpectedly.');

            status(`Loaded all ${expected} entries. Expanding lorebook tags…`);
            await expandTags();
            metadata = lorebookMetadata();
            if (!metadata.name) throw new Error('Lorebook name disappeared during scan.');
            if (stopped) throw new Error('Stopped by user.');

            // all list rows should now be in the DOM. Requery for each selection.
            const rowList = entryRows().map((row, i) => ({ index: row.index, title: row.title, ordinal: i }));
            for (const item of rowList) {
                if (stopped) throw new Error('Stopped by user; export is partial.');
                const row = xp(PATH.list)?.children[item.index];
                if (!row) {
                    warning(`Missing row at DOM index ${item.index} (${item.title}).`);
                    continue;
                }
                const clickTarget = row.querySelector(':scope > div:first-child') || row;
                const priorTitle = selectedTitle();
                clickTarget.click();
                const selected = await sleepUntil(() => selectedTitle() === item.title, 3000);
                if (!selected) {
                    warning(`Skipped ${item.title}: selection did not change (showed ${selectedTitle()}).`);
                    continue;
                }
                await pause(priorTitle === item.title ? 260 : 150);
                const entry = selectedEntry(item.title);
                entry.index = item.ordinal + 1;
                if (entry.title !== item.title) warning(`Title mismatch at entry ${item.ordinal + 1}.`);
                if (!entry._diagnostics.descriptionFound) warning(`${item.title}: description element not found.`);
                if (!entry.description.trim()) warning(`${item.title}: description is empty.`);
                if (!entry._diagnostics.keyContainerFound) warning(`${item.title}: key container not found.`);
                if (entry.descriptionChars > 4096) warning(`${item.title}: summary exceeds 4096 characters (${entry.descriptionChars}).`);
                if (entry.activationKeysChars > 1024) warning(`${item.title}: keys exceed 1024 characters (${entry.activationKeysChars}).`);
                delete entry._diagnostics;
                entries.push(entry);
                status(`Extracting entries: ${entries.length} / ${expected}\nLast: ${entry.title}\nWarnings: ${warnings.length}`);
            }
            complete = entries.length === expected && entries.every(e => e.description.trim());
            if (entries.length !== expected) warning(`COUNT MISMATCH: exported ${entries.length}/${expected}.`);
            status(`${complete ? 'SCAN COMPLETE' : 'SCAN INCOMPLETE'}\n` +
                   `Exported: ${entries.length} / ${expected} entries\nWarnings: ${warnings.length}\n` +
                   'Use JSON for reconciliation; verify content before deleting the original.');
        } catch (err) {
            warning(String(err?.message || err));
            status(`SCAN INCOMPLETE — ${entries.length}/${expected ?? '?'} entries.\n` +
                   `Reason: ${err?.message || err}\n` +
                   (entries.length ? 'Partial diagnostic export available; do not replace the original.' : 'No export created.'));
        } finally {
            setScroll(scroller, initialScroll);
            busy = false;
            $('scan').disabled = $('preview').disabled = false;
            $('stop').disabled = true;
            $('download').disabled = entries.length === 0;
            refreshHeader();
        }
    };

    const filename = s => String(s || 'Lorebook')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_').replace(/_+/g, '_')
    .replace(/^[._ ]+|[._ ]+$/g, '').slice(0, 120) || 'Lorebook';
    const pad = n => String(n).padStart(2, '0');
    const dateStamp = () => {
        const d = new Date();
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
            `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    };

    function audit() {
        return {
            format: 'moescape-lorebook-audit-v1.2',
            sourceUrl: location.href,
            metadata,
            expectedEntryCount: expected,
            exportedEntryCount: entries.length,
            complete,
            scanStartedAt: started,
            exportedAt: new Date().toISOString(),
            warnings,
            entries
        };
    }

    const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const xml = value => String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // character.AI's documented import shape (also accepted by some other sites):
    // { "entries": { "0": { "comment": "Title", "key": ["word"], "content": "..." } } }
    // no audit fields are included: other importers may reject them.
    // preserve all keys by default; the optional strict mode caps keys at 8 for Character.AI.
    function importJSON(data, strictCharacterAI = false) {
        const result = { entries: {} };
        data.entries.forEach((entry, index) => {
            const keys = Array.isArray(entry.activationKeys) ? entry.activationKeys : [];
            result.entries[String(index)] = {
                comment: entry.title,
                key: strictCharacterAI ? keys.slice(0, 8) : keys,
                content: entry.description
            };
        });
        return JSON.stringify(result, null, 2);
    }

    function serialize(format, data) {
        const meta = data.metadata;
        if (format === 'IMPORT_JSON') return importJSON(data, $('limitKeys').checked);
        if (format === 'JSON') return JSON.stringify(data, null, 2);
        if (format === 'JSONL') {
            return [
                JSON.stringify({ recordType: 'lorebook', ...Object.fromEntries(
                    Object.entries(data).filter(([k]) => k !== 'entries')
                ) }),
                ...data.entries.map(entry => JSON.stringify({ recordType: 'entry', ...entry }))
            ].join('\n') + '\n';
        }
        if (format === 'CSV') {
            const keys = ['recordType', 'entryIndex', 'title', 'description', 'activationKeys',
                          'descriptionChars', 'activationKeysChars', 'lorebookName', 'author', 'imageUrl',
                          'lorebookDescription', 'descriptionParagraphs', 'tags', 'likes',
                          'updated', 'created', 'scanDepth', 'recursiveDepth', 'expectedEntryCount',
                          'exportedEntryCount', 'complete', 'warnings'];
            const rows = [{
                recordType: 'lorebook', lorebookName: meta.name, author: meta.author,
                imageUrl: meta.imageUrl, lorebookDescription: meta.description,
                descriptionParagraphs: JSON.stringify(meta.descriptionParagraphs),
                tags: JSON.stringify(meta.tags), likes: meta.likes, updated: meta.updated,
                created: meta.created, scanDepth: meta.scanDepth,
                recursiveDepth: meta.recursiveDepth,
                expectedEntryCount: data.expectedEntryCount, exportedEntryCount: data.exportedEntryCount,
                complete: data.complete, warnings: JSON.stringify(data.warnings)
            }, ...data.entries.map(e => ({
                recordType: 'entry', entryIndex: e.index, title: e.title,
                description: e.description, activationKeys: JSON.stringify(e.activationKeys),
                descriptionChars: e.descriptionChars, activationKeysChars: e.activationKeysChars
            }))];
            return [keys.map(csvCell).join(','), ...rows.map(row =>
                                                             keys.map(key => csvCell(row[key])).join(','))].join('\r\n');
        }
        if (format === 'TXT') {
            return [
                `LOREBOOK: ${meta.name}`, `Author: ${meta.author}`, `Image URL: ${meta.imageUrl}`,
                `Description:\n${meta.description}`, `Tags: ${meta.tags.join(', ')}`,
                `Likes: ${meta.likes}`, `Updated: ${meta.updated}`, `Created: ${meta.created}`,
                `Scan Depth: ${meta.scanDepth}`, `Recursive Depth: ${meta.recursiveDepth}`,
                `Entries: ${data.exportedEntryCount} / ${data.expectedEntryCount}`,
                `Complete: ${data.complete}`, `Warnings: ${data.warnings.join(' | ') || '(none)'}`,
                ...data.entries.map(e => '\n' + '='.repeat(55) + '\n' +
                                    `ENTRY ${e.index}: ${e.title}\n` +
                                    `Description (${e.descriptionChars} chars):\n${e.description}\n` +
                                    `Activation Keys (${e.activationKeysChars} chars):\n` +
                                    e.activationKeys.map(k => `- ${k}`).join('\n') + '\n')
            ].join('\n') + '\n';
        }
        if (format === 'XML') {
            const tag = (name, value) => `<${name}>${xml(value)}</${name}>`;
            return `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<lorebook complete="${data.complete}" expectedEntries="${data.expectedEntryCount}" ` +
                `exportedEntries="${data.exportedEntryCount}">\n  <metadata>\n` +
                ['name', 'author', 'imageUrl', 'description', 'likes', 'updated', 'created',
                 'scanDepth', 'recursiveDepth'].map(key => `    ${tag(key, meta[key])}`).join('\n') +
                `\n    <descriptionParagraphs>${meta.descriptionParagraphs.map(p => tag('paragraph', p)).join('')}</descriptionParagraphs>` +
                `\n    <tags>${meta.tags.map(t => tag('tag', t)).join('')}</tags>\n  </metadata>\n` +
                `  <warnings>${data.warnings.map(w => tag('warning', w)).join('')}</warnings>\n` +
                `  <entries>\n` + data.entries.map(e =>
                                                   `    <entry index="${e.index}">` + tag('title', e.title) +
                                                   tag('description', e.description) +
                                                   `<activationKeys>${e.activationKeys.map(k => tag('key', k)).join('')}</activationKeys>` +
                                                   tag('descriptionChars', e.descriptionChars) +
                                                   tag('activationKeysChars', e.activationKeysChars) + `</entry>`
        ).join('\n') + `\n  </entries>\n</lorebook>\n`;
    }
      throw new Error('Unsupported export format: ' + format);
  }

    $('download').onclick = () => {
        if (!entries.length) return;
        const format = $('format').value;
        const isImport = format === 'IMPORT_JSON';
        const strict = isImport && $('limitKeys').checked;

        if (isImport) {
            if (!complete) {
                warning('Import JSON blocked: scan is incomplete. Use audit JSON to inspect the partial results.');
                status('Import JSON requires a complete scan. Export JSON for partial diagnostics instead.');
                return;
            }
            const overEight = entries.filter(entry => entry.activationKeys.length > 8);
            if (strict && overEight.length) {
                const omitted = overEight.reduce((n, entry) => n + entry.activationKeys.length - 8, 0);
                if (!window.confirm(`Strict Character.AI mode will omit ${omitted} activation keys across ${overEight.length} entries. The audit export is unchanged. Continue?`)) return;
            } else if (!strict && overEight.length) {
                warning(`${overEight.length} entries have more than 8 keys. All keys are preserved, but Character.AI may require you to reduce them before saving.`);
            }
        }

        const content = serialize(format, audit());
        const type = {
            JSON: 'application/json', IMPORT_JSON: 'application/json',
            JSONL: 'application/x-ndjson', CSV: 'text/csv',
            TXT: 'text/plain', XML: 'application/xml'
        }[format];
        const blob = new Blob([content], { type: `${type};charset=utf-8` });
        if (strict && blob.size > 10 * 1024 * 1024) {
            warning('Character.AI limits uploads to 10 MB. Strict import file was not downloaded.');
            return;
        }
        if (isImport && blob.size > 10 * 1024 * 1024) {
            warning('Import JSON exceeds Character.AI’s 10 MB file limit; another site may accept it.');
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const exportName = strict ? 'IMPORT_JSON_CAI8' : format;
        const extension = isImport ? 'json' : format.toLowerCase();
        link.download = `${filename($('bookName').value || metadata.name)}_${exportName}_${dateStamp()}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    console.info('[Lorebook Export] v1.3 ready; all operations are local and read-only.');
})();
