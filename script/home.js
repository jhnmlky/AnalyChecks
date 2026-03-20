window.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('status');
    try {
        const res = await fetch('php/check_data.php');
        const j = await res.json();
        if (j.exists) {
            status.innerHTML = 'Loaded previous data.';
            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth'
            });
            const refresh = true;
            renderResult(j, refresh);
        }
    } catch (e) {
        status.innerHTML = `Error: ${e}`;
    }
});

function logout() {
    var confirmed = confirm("Are you sure you want to log out?");
    if (confirmed) {
        window.location.href = "php/logout.php";
    }
}

let globalMeta = null;
let chartInstance = null;
let predictChartInstance = null;
const flags = [false, false];
let onAllTrue = () => {};
let onSomeFalse = () => {};
function setFlag(index, value) {
    if (index < 0 || index >= flags.length) { addFlag(); return; }
    flags[index] = value;
    if (flags.every(v => v === true)) onAllTrue();
    else onSomeFalse();
}
function addFlag() {
    flags.push(false);
    onSomeFalse();
}
onAllTrue = () => {
    document.getElementById('btnGenerateReport').disabled = false;
    document.getElementById('btnGenerateReport').classList.add('active');
};
onSomeFalse = () => {
    document.getElementById('btnGenerateReport').disabled = true;
    document.getElementById('btnGenerateReport').classList.remove('active');
};

document.getElementById('fileinput').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const res = await fetch('php/get_session.php');
    const data = await res.json();
    const btnUpload = document.getElementById('btnUpload');
    btnUpload.innerHTML = `${files.length > 1 ? 'Upload Files' : 'Upload File'}`;
    const status = document.getElementById('status');
    status.innerHTML = `${files.length} ${files.length > 1 ? 'files' : 'file'} ready for upload.${data.has_data ? ' Caution: Your previous uploads will be deleted.' : ''}`;
});

function inferColumnType(values) {
    let isInt = true, isFloat = true, isDate = true;
    let seenNonEmpty = false;
    const isLikelyDateString = (s) => {
        if (!s || typeof s !== 'string') return false;
        if (!/\b\d{4}\b/.test(s)) return false;
        const sepCount = (s.match(/[\/\-]/g) || []).length;
        if (sepCount < 2) return false;
        if (/^\d+$/.test(s) || s.length < 6) return false;
        const d = new Date(s);
        return !isNaN(d.getTime());
    };
    const isExcelDateNumber = (v) =>
        typeof v === 'number' && v > 25000 && v < 80000;
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s.length === 0) continue;
        seenNonEmpty = true;
        if (isExcelDateNumber(v)) {
            isDate = true;
            isInt = false;
            isFloat = false;
            continue;
        }
        if (isLikelyDateString(s)) {
            const parts = s.split(/[\/\-]/).map(Number);
            const [a, b, c] = parts;
            if ((a <= 31 && b <= 12 && c > 30) || (c <= 31 && b <= 12 && a > 30)) {
                isDate = true;
                isInt = false;
                isFloat = false;
                continue;
            }
        }
        isDate = false;
        if (!/^[+-]?\d+$/.test(s)) isInt = false;
        if (!/^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) isFloat = false;
    }
    if (!seenNonEmpty) return 'TEXT';
    if (isDate) return 'DATETIME';
    if (isInt) return 'INT';
    if (isFloat) return 'DOUBLE';
    return 'TEXT';
}

function sanitizeIdentifier(name){
    if (!name) name = 'col';
    name = String(name).trim().replace(/\s+/g,'_').replace(/[^A-Za-z0-9_]/g,'_');
    if (!/^[A-Za-z]/.test(name)) name = 'c_' + name;
    return name.substring(0,64);
}

function parseFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = e => reject(e);
        reader.onload = e => {
            const data = e.target.result;
            let wb;
            try {
                if (file.name.match(/\.csv$/i)) {
                    wb = XLSX.read(data, { type: "string" });
                } else {
                    wb = XLSX.read(data, { type: "binary" });
                }
            } catch (err) {
                reject(err);
                return;
            }

            const resultTables = [];
            wb.SheetNames.forEach(sheetName => {
                const ws = wb.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

                json.forEach(row => {
                    for (const key in row) {
                        const val = row[key];
                        if (typeof val === 'string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(val)) {
                            const d = new Date(val);
                            if (!isNaN(d)) {
                                const yyyy = d.getFullYear();
                                const mm = String(d.getMonth() + 1).padStart(2, '0');
                                const dd = String(d.getDate()).padStart(2, '0');
                                row[key] = `${yyyy}-${mm}-${dd}`;
                            }
                        }
                        if (val instanceof Date) {
                            const yyyy = val.getFullYear();
                            const mm = String(val.getMonth() + 1).padStart(2, '0');
                            const dd = String(val.getDate()).padStart(2, '0');
                            row[key] = `${yyyy}-${mm}-${dd}`;
                        }
                    }
                });

                let headers = [];
                if (json.length > 0) {
                    headers = Object.keys(json[0]);
                } else if (ws["!ref"]) {
                    headers = ["col1"];
                } else {
                    headers = ["col1"];
                }
                const columns = headers.map(h => ({
                    orig: h,
                    name: sanitizeIdentifier(h),
                    samples: []
                }));

                const rows = json.map(rowObj => {
                    const out = {};
                    columns.forEach(col => {
                        const raw = rowObj.hasOwnProperty(col.orig) ? rowObj[col.orig] : null;
                        out[col.name] = raw;
                        col.samples.push(raw);
                    });
                    return out;
                });

                const colsWithTypes = columns.map(col => {
                    const t = inferColumnType(col.samples);
                    return { name: col.name, orig: col.orig, type: t };
                });

                const base = file.name.replace(/\.[^/.]+$/, "");
                const tableName = sanitizeIdentifier(base + "_" + sheetName);

                resultTables.push({
                    tableName,
                    columns: colsWithTypes,
                    rows
                });
            });

            resolve(resultTables);
        };

        if (file.name.match(/\.csv$/i)) {
            reader.readAsText(file);
        } else {
            reader.readAsArrayBuffer(file);
        }
    });
}

document.getElementById('btnUpload').addEventListener('click', async () => {
    const files = document.getElementById('fileinput').files;
    if (!files || files.length === 0) { alert('Choose at least one file'); return; }
    const status = document.getElementById('status');
    status.innerHTML = 'Parsing files...';
    const allTables = [];
    try {
        for (const f of files){
            status.innerHTML = `Parsing ${f.name}...`;
            const tables = await parseFile(f);
            tables.forEach(t => t._file = f.name);
            allTables.push(...tables);
        }
    } catch(err){
        status.innerHTML = `Error parsing files: ${err.message}`;
        return;
    }

    const payloadTables = allTables.map(t => {
        const cols = t.columns;
        const colNames = cols.map(c => c.name);
        const rows = t.rows.map(r => colNames.map(cn => (r[cn] === undefined ? null : r[cn])));
        return {
            tableName: t.tableName,
            columns: cols.map(c => ({ name: c.name, type: c.type })),
            rows
        };
    });

    status.innerHTML = 'Uploading to server...';
    try {
        const form = new FormData();
        form.append('tables', JSON.stringify(payloadTables));
        const res = await fetch('php/upload.php', {
            method:'POST',
            body: form
        });
        const json = await res.json();
        if (!res.ok) {
            status.innerHTML = `Server error: ${(json.message || res.statusText)}`;
            return;
        }
        status.innerHTML = 'Upload complete.';
        const refresh = false;
        renderResult(json, refresh);
    } catch(err){
        status.innerHTML = `Upload failed: ${err.message}`;
    }
});

let pendingTypeChanges = {};

function renderResult(meta, refresh) {
    globalMeta = meta;
    document.getElementById('result').style.display = 'block';
    document.getElementById('graphCard').style.display = 'block';
    document.getElementById('predictCard').style.display = 'block';
    document.getElementById('reportCard').style.display = 'block';
    if (chartInstance) chartInstance.destroy();
    if (predictChartInstance) predictChartInstance.destroy();
    document.getElementById('chartCanvas').style.display = 'none';
    document.getElementById('predictChartCanvas').style.display = 'none';

    const metaDiv = document.getElementById('meta');
    metaDiv.innerHTML = '';

    const h = document.createElement('div');
    h.className = 'result-header';
    h.innerHTML = ` <b>${meta.tables.length}</b> tables have been created</b>`;
    metaDiv.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'table-grid';
    meta.tables.forEach(t => {
        const card = document.createElement('div');
        card.className = 'table-card';

        card.innerHTML = `
            <h4>${t.tableName.toUpperCase()} <span class="small">(${t.row_count} rows)</span></h4>
        `;

        const cols = document.createElement('div');
        cols.className = 'cols-badges';

        t.columns.forEach((col, idx) => {
            const table = t.tableName;
            const colIndex = idx;
            const colName = col.name;
            const newType = col.type;
            cols.appendChild(buildBadgeElement({ table, colIndex, colName, type: newType }));
        });
        card.appendChild(cols);

        const buttons = document.createElement('div');
        buttons.className = 'badge-buttons';

        const btn = document.createElement('a');
        btn.href = '#';
        btn.className = 'btn-preview';
        btn.textContent = '🔍 Preview';
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const resp = await fetch(`php/preview.php?table=${encodeURIComponent(t.tableName)}`);
            const j = await resp.json();
            showPreview(j);
        });
        buttons.appendChild(btn);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '💾 Save Changes';
        const tableName = t.tableName.replace(/[^A-Za-z0-9_-]/g, '_');
        saveBtn.className = `save-types-btn save-btn-${tableName}`;
        saveBtn.dataset.table = t.tableName;
        saveBtn.disabled = true;
        saveBtn.addEventListener('click', async () => {
            const table = saveBtn.dataset.table;
            const changes = pendingTypeChanges[table];
            if (!changes || Object.keys(changes).length === 0) return;

            saveBtn.textContent = 'Saving...';
            saveBtn.disabled = true;

            try {
                const form = new FormData();
                form.append('table', table);
                form.append('changes', JSON.stringify(changes));

                const res = await fetch('php/update_type.php', {
                    method: 'POST',
                    body: form
                });

                const j = await res.json();
                const refresh = false;
                if (j.success) {
                    renderResult(j, refresh);
                    saveBtn.textContent = 'Saved ✔️';
                    delete pendingTypeChanges[table];
                } else {
                    saveBtn.textContent = 'Error ❌';
                    saveBtn.disabled = false;
                    setTimeout(() => (saveBtn.textContent = '💾 Save Changes'), 2000);
                }
            } catch (err) {
                saveBtn.textContent = 'Error ❌';
                saveBtn.disabled = false;
                setTimeout(() => (saveBtn.textContent = '💾 Save Changes'), 2000);
            }
        });

        buttons.appendChild(saveBtn);
        card.appendChild(buttons);
        grid.appendChild(card);
    });
    metaDiv.appendChild(grid);

    const xSel = document.getElementById('xAxis');
    const ySel = document.getElementById('yAxis');
    const showAllColumns = document.getElementById('showAllColumns');
    showAllColumns.checked = false;

    function populateAxisSelectors(meta) {
        xSel.innerHTML = '';
        ySel.innerHTML = '';

        const showAll = showAllColumns?.checked;

        meta.tables.forEach(t => {
            t.columns.forEach(c => {
                const qualifiedName = `${t.tableName.toUpperCase()}.${c.name}`;
                const label = qualifiedName;
                const isLikelyID = (name) => /(?:^|_)(postal|zip|code|id|contact|phone|no|num|ssn)(?:_|$)/i.test(name);

                if (showAll) {
                    const optX = document.createElement('option');
                    optX.value = qualifiedName;
                    optX.textContent = label;
                    xSel.appendChild(optX);

                    const optY = optX.cloneNode(true);
                    ySel.appendChild(optY);
                    return;
                }

                if (['TEXT', 'DATETIME'].includes(c.type) && !isLikelyID(c.name)) {
                    const optX = document.createElement('option');
                    optX.value = qualifiedName;
                    optX.textContent = label;
                    xSel.appendChild(optX);
                }

                if (['INT', 'DOUBLE'].includes(c.type) && !isLikelyID(c.name)) {
                    const optY = document.createElement('option');
                    optY.value = qualifiedName;
                    optY.textContent = label;
                    ySel.appendChild(optY);
                }
            });
        });
    }
    showAllColumns.onchange = () => populateAxisSelectors(meta);

    const selX = document.getElementById('predictX');
    const selY = document.getElementById('predictY');

    function populatePredictAxisSelectors(meta) {
        selX.innerHTML = '';
        selY.innerHTML = '';

        meta.tables.forEach(t => {
            t.columns.forEach(col => {
                const qualified = `${t.tableName.toUpperCase()}.${col.name}`;
                const label = qualified;
                const isLikelyID = (name) => /(?:^|_)(postal|zip|code|id|contact|phone|no|num|ssn)(?:_|$)/i.test(name);

                if (['DATETIME'].includes(col.type) && !isLikelyID(col.name)) {
                    const opt = document.createElement('option');
                    opt.value = qualified;
                    opt.textContent = label;
                    selX.appendChild(opt);
                }

                if (['INT', 'DOUBLE'].includes(col.type) && !isLikelyID(col.name)) {
                    const optY = document.createElement('option');
                    optY.value = qualified;
                    optY.textContent = label;
                    selY.appendChild(optY);
                }
            });
        });
    }

    populateAxisSelectors(meta);
    populatePredictAxisSelectors(meta);
    generateGlobalSummary(meta, refresh);
    generateCorrelationMatrix(meta, refresh);
}

document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('editable-type')) {
        openInlineTypeEditor(t);
    }
});

function buildBadgeElement({ table, colIndex, colName, type, modified = false }) {
    const span = document.createElement('span');
    span.className = 'badge editable-type' + (modified ? ' modified' : '');
    span.dataset.table = table;
    span.dataset.colIndex = String(colIndex);
    span.dataset.type = type;
    span.dataset.colName = colName;
    span.innerHTML = `${colName} : ${type}` + (modified ? '' : ' <span class="edit-icon">✏️</span>');
    return span;
}

function openInlineTypeEditor(badge) {
    if (badge.dataset.editing === '1') return;
    badge.dataset.editing = '1';

    const table = badge.dataset.table;
    const colIndex = badge.dataset.colIndex;
    const colName = badge.dataset.colName || badge.textContent.split(':')[0].trim();
    const currentType = badge.dataset.type;

    const select = document.createElement('select');
    select.className = 'type-select';
    const types = ['INT', 'DOUBLE', 'TEXT', 'DATETIME'];
    types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === currentType) opt.selected = true;
        select.appendChild(opt);
    });

    const parent = badge.parentNode;
    if (!parent) return;
    parent.replaceChild(select, badge);
    select.focus();

    function cleanup(replacementBadge) {
        if (!select.parentNode) return;
        select.parentNode.replaceChild(replacementBadge, select);
        replacementBadge.dataset.editing = '0';
    }

    select.addEventListener('change', (ev) => {
        const newType = ev.target.value;
        recordTypeChange(table, colIndex, newType);
        const newBadge = buildBadgeElement({ table, colIndex, colName, type: newType, modified: true });
        cleanup(newBadge);
    });

    select.addEventListener('blur', () => {
        const pendingForThis = (pendingTypeChanges[table] && pendingTypeChanges[table][colIndex]);
        const finalType = pendingForThis || currentType;
        const wasModified = Boolean(pendingForThis);
        const finalBadge = buildBadgeElement({ table, colIndex, colName, type: finalType, modified: wasModified });
        cleanup(finalBadge);
    });
}

function recordTypeChange(table, colIndex, newType) {
    if (!pendingTypeChanges[table]) pendingTypeChanges[table] = {};
    pendingTypeChanges[table][colIndex] = newType;
    const tableName = table.replace(/[^A-Za-z0-9_-]/g, '_');
    const saveBtn = document.querySelector(`.save-btn-${tableName}`);
    if (saveBtn) {
        saveBtn.classList.add('active');
        saveBtn.disabled = false;
    }
}

function sanitizeLabel(label) {
    if (!label) return '';
    const parts = String(label).split('.');
    const table = parts[0] || '';
    const col = parts.slice(1).join('.') || '';

    function clean(text) {
        return String(text || '')
        .replace(/[_\-]+/g, ' ')
        .replace(/[^A-Za-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
    }

    if (!col) return clean(table);
    return `${clean(table)}: ${clean(col)}`;
}

function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & 0xFFFFFFFF;
    }
    return (hash >>> 0).toString(16);
}

async function generateCorrelationMatrix(meta, refresh = false) {
    const matrixCard = document.querySelector('#correlationMatrix');
    const matrixBox = matrixCard.querySelector('.matrix-box');
    matrixBox.innerHTML = '<p class="small">Loading correlation matrix...</p>';
    matrixCard.style.display = 'block';

    const combined = {};
    const colsSet = new Set();

    for (const table of meta.tables) {
        try {
            const resp = await fetch(`php/correlation.php?table=${encodeURIComponent(table.tableName)}`);
            const j = await resp.json();
            if (j && j.correlation) {
                for (const [colA, row] of Object.entries(j.correlation)) {
                    const fullA = `${table.tableName}.${colA}`;
                    colsSet.add(fullA);
                    if (!combined[fullA]) combined[fullA] = {};
                    for (const [colB, val] of Object.entries(row)) {
                        const fullB = `${table.tableName}.${colB}`;
                        colsSet.add(fullB);
                        combined[fullA][fullB] = (val === null ? null : Number(val));
                    }
                }
            }
        } catch (e) {
            matrixBox.innerHTML = `<p class="small">Failed to fetch correlations for ${table.tableName}: ${e}</p>`;
        }
    }

    const columns = Array.from(colsSet);
    columns.sort((a, b) => {
        const [ta, ...ca] = a.split('.');
        const [tb, ...cb] = b.split('.');
        const sa = ta.toLowerCase(), sb = tb.toLowerCase();
        if (sa < sb) return -1;
        if (sa > sb) return 1;
        return ca.join('.').localeCompare(cb.join('.'));
    });

    if (columns.length < 2) {
        matrixBox.innerHTML = '<p class="small">Not enough numeric columns to compute a unified correlation matrix.</p>';
        return;
    }

    renderCorrelationMatrix(columns, combined);
    await getCorrelationInsight(combined, refresh);
}

const CORR_INSIGHT_TTL = 1000 * 60 * 60 * 24;

async function getCorrelationInsight(correlationData, refresh = false) {
    document.getElementById('correlation-insight-box').style.display = 'flex';
    const box = document.querySelector('#correlation-insight');
    const cacheKey = `correlation_insight:${simpleHash(JSON.stringify(correlationData))}`;

    if (refresh) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const { value, ts } = JSON.parse(cached);
                if (!CORR_INSIGHT_TTL || (Date.now() - ts < CORR_INSIGHT_TTL)) {
                    box.textContent = value;
                    setFlag(1, true);
                    return;
                } else {
                    localStorage.removeItem(cacheKey);
                }
            } catch (err) {}
        }
    }

    box.textContent = 'Getting insights ...';

    try {
        const form = new FormData();
        form.append('correlation', JSON.stringify(correlationData));

        const res = await fetch('php/ai_insights.php', {
            method: 'POST',
            body: form
        });

        const j = await res.json();

        const insight = j.insight ? j.insight : `AI insight error${j.error ? `: ${j.error}` : ''}`;
        box.textContent = insight;
        setFlag(1, true);

        try {
            localStorage.setItem(
                cacheKey,
                JSON.stringify({ ts: Date.now(), value: insight })
            );
        } catch (err) {}
    } catch (err) {
        box.textContent = `Failed to get correlation insights: ${err}`;
    }
}

function renderCorrelationMatrix(columns, corrData) {
    const matrixCard = document.querySelector('#correlationMatrix');
    const matrixBox = matrixCard.querySelector('.matrix-box');

    let html = `
        <div class="corr-legend">
            <div class="legend-bar"></div>
            <div class="legend-labels"><span>-1</span><span>0</span><span>+1</span></div>
        </div>
        <div class="corr-scroll">
        <table class="corr-table" role="grid" aria-label="Unified correlation matrix">
            <thead>
            <tr><th class="first">Variables</th>${columns.map(c => `<th title="${sanitizeLabel(c)}">${sanitizeLabel(c)}</th>`).join('')}</tr>
            </thead>
            <tbody>
    `;

    for (const rowCol of columns) {
        html += `<tr><th title="${sanitizeLabel(rowCol)}">${sanitizeLabel(rowCol)}</th>`;
        for (const col of columns) {
            let val = null;
            if (corrData[rowCol] && typeof corrData[rowCol][col] !== 'undefined') val = corrData[rowCol][col];
            else if (corrData[col] && typeof corrData[col][rowCol] !== 'undefined') val = corrData[col][rowCol];
            else if (rowCol === col) val = 1.0;
            if (typeof val === 'number') {
                if (!isFinite(val)) val = null;
                else if (val > 1) val = 1;
                else if (val < -1) val = -1;
            } else {
                val = (val === null ? null : (Number(val) || null));
            }

            const display = (val === null) ? '-' : Number(val).toFixed(2);
            const { bg, fg } = calcCorrColors(val);
            const tooltip = `${sanitizeLabel(rowCol)} vs ${sanitizeLabel(col)}: ${val === null ? 'n/a' : Number(val).toFixed(3)}`;
            html += `<td title="${tooltip}" style="background:${bg};color:${fg}">${display}</td>`;
        }
        html += `</tr>`;
    }

    html += `</tbody></table></div>`;
    matrixBox.innerHTML = html;
}

function calcCorrColors(value) {
    if (value === null || typeof value === 'undefined' || isNaN(value)) {
        return { bg: '#efefef', fg: '#333' };
    }
    const v = Math.max(-1, Math.min(1, Number(value)));
    const r = v < 0 ? 255 : Math.round(255 * (1 - v));
    const g = 255 - Math.round(255 * Math.abs(v));
    const b = v > 0 ? 255 : Math.round(255 * (1 + v));
    const bg = `rgb(${r},${g},${b})`;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const fg = lum < 140 ? '#fff' : '#000';
    return { bg, fg };
}

function cleanNum(val) {
    if (val === null || val === undefined || val === '' || val === '-') return '-';
    const num = Number(val);
    if (isNaN(num)) return val;
    return parseFloat(num.toFixed(6)).toString();
}

async function generateGlobalSummary(meta, refresh) {
    const summaryContainer = document.querySelector('#globalSummary');
    const summaryBox = summaryContainer.querySelector('.summary-box');
    summaryBox.innerHTML = '<p class="small">Loading global summary...</p>';
    summaryContainer.style.display = 'block';

    const globalSummary = {};

    for (const table of meta.tables) {
        const numericCols = table.columns.filter(c => ['INT', 'DOUBLE'].includes(c.type));
        if (numericCols.length === 0) continue;

        try {
            const resp = await fetch(`php/summary.php?table=${encodeURIComponent(table.tableName)}`);
            const j = await resp.json();
            if (!j.summary) continue;

            for (const [colName, s] of Object.entries(j.summary)) {
                if (numericCols.some(c => c.name === colName)) {
                    globalSummary[`${table.tableName}.${colName}`] = s;
                }
            }
        } catch (e) {
            summaryBox.innerHTML = `<p class="small">Failed to get summary for ${table.tableName}: ${e}</p>`;
        }
    }

    if (!globalSummary || Object.keys(globalSummary).length === 0) {
        summaryBox.innerHTML = '<p class="small">No numeric columns available for summary.</p>';
        return;
    }

    renderGlobalSummary(globalSummary);
    await getSummaryInsight(globalSummary, refresh);
}

async function getSummaryInsight(globalSummary, refresh) {
    document.getElementById('summary-insight-box').style.display = 'flex';
    const box = document.querySelector('#summary-insight');
    const cacheKey = `summary_insight:${simpleHash(JSON.stringify(globalSummary))}`;

    if (refresh) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { value, ts } = JSON.parse(cached);
            box.textContent = value;
            setFlag(0, true);
            return;
        }
    }

    box.textContent = 'Getting insights ...';

    try {
        const form = new FormData();
        form.append('summary', JSON.stringify(globalSummary));

        const res = await fetch('php/ai_insights.php', {
            method: 'POST',
            body: form
        });

        const j = await res.json();

        const insight = j.insight ? j.insight : `AI insight error${j.error ? `: ${j.error}` : ''}`;
        box.textContent = insight;
        setFlag(0, true);

        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                ts: Date.now(),
                value: insight
            }));
        } catch (err) {}
    } catch (err) {
        box.textContent = `Failed to get summary insights: ${err}`;
    }
}

function renderGlobalSummary(summary) {
    const summaryContainer = document.querySelector('#globalSummary');
    const summaryBox = summaryContainer.querySelector('.summary-box');

    let html = `<table class="summary-table">
        <thead><tr>
        <th class="first">Column</th>
        <th>Mean</th>
        <th>Median</th>
        <th>Mode</th>
        <th>Min</th>
        <th>Max</th>
        <th>Nulls</th>
        </tr></thead>
        <tbody>`;

    for (const [colName, s] of Object.entries(summary)) {
        html += `<tr>
        <th>${colName}</th>
        <td>${cleanNum(s.mean) ?? '-'}</td>
        <td>${cleanNum(s.median) ?? '-'}</td>
        <td>${s.modeVal ?? '-'}</td>
        <td>${s.min ?? '-'}</td>
        <td>${s.max ?? '-'}</td>
        <td>${s.nullCount ?? '-'}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    summaryBox.innerHTML = html;
}

let colorIndex = 0;

function getDistinctColor(index = null) {
    if (index === null) index = colorIndex++;
    const hue = (index * 137.508) % 360;
    return `hsl(${hue}, 70%, 55%)`;
}

const btnPNG = document.getElementById('btnDownloadPNG');
const btnPDF = document.getElementById('btnDownloadPDF');

btnPNG.addEventListener('click', () => {
    if (!chartInstance) return alert('No chart to download.');

    const canvas = chartInstance.canvas;
    const ctx = canvas.getContext('2d');

    const original = ctx.getImageData(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `chart_${timestamp}.png`;
    link.href = canvas.toDataURL('image/png', 1);
    link.click();

    ctx.putImageData(original, 0, 0);
});

btnPDF.addEventListener('click', () => {
    if (!chartInstance) return alert('No chart to export.');

    const canvas = chartInstance.canvas;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape' });

    const imgData = canvas.toDataURL('image/png', 1);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth - 20;
    const imgHeight = (canvas.height / canvas.width) * imgWidth;

    pdf.text('Chart Export', 10, 10);
    pdf.addImage(imgData, 'PNG', 10, 20, imgWidth, imgHeight);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 10, pageHeight - 10);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    pdf.save(`chart_${timestamp}.pdf`);
});

function renderChart(type, xLabels, series, xCol) {
    const canvas = document.getElementById('chartCanvas');
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const colors = xLabels.map((_, i) => getDistinctColor(i));
    const categoryCount = new Set(xLabels).size;

    function cleanDateLabel(value) {
        if (typeof value !== "string") return value;
        return value.replace(/\s*00:00(:00)?$/, "");
    }

    function allTimesAreMidnight(labels) {
        const datetimePattern = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/;
        const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
        let hasDateTime = false;
        let allMidnight = true;

        for (const l of labels) {
            if (typeof l !== "string") continue;
            if (dateOnlyPattern.test(l)) continue;
            if (datetimePattern.test(l)) {
                hasDateTime = true;
                if (!l.match(/\s00:00(:00)?$/)) {
                    allMidnight = false;
                    break;
                }
            }
        }
        return hasDateTime && allMidnight;
    }

    const shouldStripTime = allTimesAreMidnight(xLabels);
    const cleanedLabels = shouldStripTime
        ? xLabels.map(l => cleanDateLabel(l))
        : [...xLabels];

    const yTitle = series.map(s => s.label.split('.')[1]).join(' vs. ');
    
    const datasets = series.map(s => ({
        label: s.label.split('.')[1].toUpperCase().replace('_', ' '),
        data: s.data,
        borderWidth: 1,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace('0.7', '1')),
        fill: false
    }));

    chartInstance = new Chart(ctx, {
        type,
        data: { labels: cleanedLabels, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            const label = items[0].label;
                            return shouldStripTime ? cleanDateLabel(label) : label; } } } },
            scales: (type !== 'pie' && type !== 'doughnut') ? {
                x: { title: { display: true, text: `${xCol} (${categoryCount})` },
                    ticks: {
                        callback: function (value) {
                            const label = this.getLabelForValue(value);
                            const processed = shouldStripTime ? cleanDateLabel(label) : label;
                            const maxLength = 20;
                            return processed.length > maxLength ? processed.substring(0, maxLength) + '…' : processed;
                        },
                        autoSkip: true } },
                y: { title: { display: true, text: yTitle }, beginAtZero: true }
            } : {}
        }
    });
    [btnPNG, btnPDF].forEach(b => {
        b.disabled = false;
        b.classList.add('active');
    });
    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let chartInsightsCache = {};

document.getElementById('btnDraw').addEventListener('click', async () => {
    setFlag(2, false);
    const db = globalMeta.database;
    const x = document.getElementById('xAxis').value;
    const ySel = document.getElementById('yAxis');
    const y = Array.from(ySel.selectedOptions).map(opt => opt.value);
    const type = document.getElementById('chartType').value;
    if (!x || !y) { alert('Pick both axes'); return; }
    const form = new FormData();
    form.append('x', x);
    y.forEach(yCol => form.append('y[]', yCol));
    const res = await fetch(`php/get_data.php`, {
        method: 'POST',
        body: form
    });
    const j = await res.json();
    if (!res.ok || j.error) {
        document.getElementById('invalid-relation').style.display = 'block';
        document.getElementById('invalid-relation').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        if (chartInstance) chartInstance.destroy();
        document.getElementById('chartCanvas').style.display = 'none';
    } else {
        document.getElementById('invalid-relation').style.display = 'none';
        renderChart(type, j.x, j.series, x.slice(x.indexOf('.') + 1).toUpperCase().replace('_', ' '));
        const params = { db, x, yArray: y, type};
        await getOrFetchChartInsight(j, params, { persist: true, ttl: 1000 * 60 * 60 * 24 });
    }
});

const box = document.querySelector('#chart-insight');

function displayInsight(insight) {
    box.textContent = typeof insight === 'string' ? insight : JSON.stringify(insight);
    setFlag(2, true);
}

const defaultCacheOpts = { persist: true, ttl: 1000 * 60 * 60 * 24 };

async function getOrFetchChartInsight(j, { db, x, yArray, type }, cacheOpts = {}) {
    cacheOpts = Object.assign({}, defaultCacheOpts, cacheOpts);

    const baseKey = `${db}|${x}|${yArray.join(',')}|${type}`;

    const payloadStr = JSON.stringify({ x: j.x, series: j.series });
    const payloadHash = simpleHash(payloadStr);

    const cacheKey = `chart_insight:${baseKey}:${payloadHash}`;

    chartInsightsCache = chartInsightsCache || {};
    const mem = chartInsightsCache[cacheKey];

    function readPersisted(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed._ts && cacheOpts.ttl) {
                if (Date.now() - parsed._ts > cacheOpts.ttl) {
                    localStorage.removeItem(key);
                    return null;
                }
            }
            return parsed.value;
        } catch (e) {
            return null;
        }
    }
    
    document.getElementById('chart-insight-box').style.display = 'flex';

    if (mem) {
        displayInsight(mem);
        return mem;
    }

    if (cacheOpts.persist) {
        const persisted = readPersisted(cacheKey);
        if (persisted) {
            chartInsightsCache[cacheKey] = persisted;
            displayInsight(persisted);
            return persisted;
        }
    }

    box.textContent = 'Getting insights ...';

    const form = new FormData();
    form.append('x', JSON.stringify(j.x));
    form.append('series', JSON.stringify(j.series));

    const res = await fetch('php/ai_insights.php', {
        method: 'POST',
        body: form
    });

    if (!res.ok) {
        const txt = await res.text();
        box.textContent = `Failed to get chart insights: ${txt}`;
        return null;
    }

    const json = await res.json();
    if (json.error) {
        box.textContent = `AI insight error: ${json.error}`;
        return null;
    }

    const insight = json.insight ?? json;

    chartInsightsCache[cacheKey] = insight;
    if (cacheOpts.persist) {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({ _ts: Date.now(), value: insight }));
        } catch (e) {}
    }

    displayInsight(insight);
    return insight;
}

let predictInsightsCache = {};

document.getElementById('btnPredict').addEventListener('click', async () => {
    setFlag(3, false);
    const db = globalMeta.database;
    const xVal = document.getElementById('predictX').value;
    const y = document.getElementById('predictY');
    const yVals = Array.from(y.selectedOptions).map(o => o.value);
    const type = document.getElementById('predictChartType').value;
    if (!xVal || !yVals) { alert('Pick both axes'); return; }
    const form = new FormData();
    form.append('x', xVal);
    yVals.forEach(yCol => form.append('y[]', yCol));
    const res = await fetch(`php/get_data.php`, {
        method: 'POST',
        body: form
    });
    const j = await res.json();
    if (!res.ok || j.error) {
        document.getElementById('predict-invalid-relation').textContent = 'INVALID DATA RELATION';
        document.getElementById('predict-invalid-relation').style.display = 'block';
        document.getElementById('predict-invalid-relation').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        if (predictChartInstance) predictChartInstance.destroy();
        document.getElementById('predictChartCanvas').style.display = 'none';
    } else {
        document.getElementById('predict-invalid-relation').style.display = 'none';
        const predictForm = new FormData();
        predictForm.append('x', JSON.stringify(j.x));
        predictForm.append('series', JSON.stringify(j.series));
        const predRes = await fetch('php/predict.php', {
            method: 'POST',
            body: predictForm
        });

        const predJson = await predRes.json();
        if (predRes.ok && predJson.series) {
            renderPredictiveChart(j.x, predJson.series, type);
            const params = { db, x: xVal, yArray: yVals, pred: predJson, type};
            await getOrFetchPredictInsight(j, params, { persist: true, ttl: 1000 * 60 * 60 * 24 });
        } else {
            document.getElementById('predict-invalid-relation').textContent = 'PREDICTION ERROR';
            document.getElementById('predict-invalid-relation').style.display = 'block';
            document.getElementById('predict-invalid-relation').scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
            if (predictChartInstance) predictChartInstance.destroy();
            document.getElementById('predictChartCanvas').style.display = 'none';
        }
    }
});

const predictBox = document.querySelector('#predict-insight');

function displayPredictInsight(insight) {
    predictBox.textContent = typeof insight === 'string' ? insight : JSON.stringify(insight);
    setFlag(3, true);
}

async function getOrFetchPredictInsight(j, { db, x, yArray, pred, type }, cacheOpts = {}) {
    cacheOpts = Object.assign({}, defaultCacheOpts, cacheOpts);

    const baseKey = `${db}|${x}|${yArray.join(',')}|${type}`;

    const payloadStr = JSON.stringify({ x: j.x, series: j.series });
    const payloadHash = simpleHash(payloadStr);

    const cacheKey = `predict_insight:${baseKey}:${payloadHash}`;

    predictInsightsCache = predictInsightsCache || {};
    const mem = predictInsightsCache[cacheKey];

    function readPersisted(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed._ts && cacheOpts.ttl) {
                if (Date.now() - parsed._ts > cacheOpts.ttl) {
                    localStorage.removeItem(key);
                    return null;
                }
            }
            return parsed.value;
        } catch (e) {
            return null;
        }
    }
    
    document.getElementById('predict-insight-box').style.display = 'flex';

    if (mem) {
        displayPredictInsight(mem);
        return mem;
    }

    if (cacheOpts.persist) {
        const persisted = readPersisted(cacheKey);
        if (persisted) {
            predictInsightsCache[cacheKey] = persisted;
            displayPredictInsight(persisted);
            return persisted;
        }
    }

    predictBox.textContent = 'Getting insights ...';

    const form = new FormData();
    form.append('x', JSON.stringify(j.x));
    form.append('predictSeries', JSON.stringify(pred.series));

    const res = await fetch('php/ai_insights.php', {
        method: 'POST',
        body: form
    });

    if (!res.ok) {
        const txt = await res.text();
        predictBox.textContent = `Failed to get predict insights: ${txt}`;
        return null;
    }

    const json = await res.json();
    if (json.error) {
        predictBox.textContent = `AI insight error: ${json.error}`;
        return null;
    }

    const insight = json.insight ?? json;

    predictInsightsCache[cacheKey] = insight;
    if (cacheOpts.persist) {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({ _ts: Date.now(), value: insight }));
        } catch (e) {}
    }

    displayPredictInsight(insight);
    return insight;
}

function formatAxisLabel(qualified) {
    if (!qualified) return '';
    const short = qualified.slice(qualified.indexOf('.') + 1);
    return short.toUpperCase().replace(/_/g, ' ');
}

function dataSeriesSafe(s, key) {
    return Array.isArray(s[key]) ? s[key] : (Array.isArray(s.data) ? s.data : []);
}

function renderPredictiveChart(xLabels, seriesArr, type) {
    const canvas = document.getElementById('predictChartCanvas');
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    if (predictChartInstance) predictChartInstance.destroy();

    function cleanDateLabel(value) {
        if (typeof value !== "string") return value;
        return value.replace(/\s*00:00(:00)?$/, "");
    }

    function allTimesAreMidnight(labels) {
        const datetimePattern = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/;
        const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
        let hasDateTime = false;
        let allMidnight = true;

        for (const l of labels) {
            if (typeof l !== "string") continue;
            if (dateOnlyPattern.test(l)) continue;
            if (datetimePattern.test(l)) {
                hasDateTime = true;
                if (!l.match(/\s00:00(:00)?$/)) {
                    allMidnight = false;
                    break;
                }
            }
        }
        return hasDateTime && allMidnight;
    }

    const shouldStripTime = allTimesAreMidnight(xLabels);
    const cleanedLabels = shouldStripTime
        ? xLabels.map(l => cleanDateLabel(l))
        : [...xLabels];

    const yTitle = seriesArr.map(s => s.label.split(':')[1].trim()).join(' vs. ');

    const datasets = [];
    seriesArr.forEach((s, i) => {
        datasets.push({
            label: `${s.label.split(':')[1].trim()} (original)`,
            data: (Array.isArray(s.original) ? s.original : dataSeriesSafe(s, 'original')),
            borderWidth: 1.25,
            borderColor: `hsl(${(i*60)%360},60%,40%)`,
            backgroundColor: `hsla(${(i*60)%360},60%,40%,0.15)`,
            pointRadius: 3,
            tension: 0.2,
            fill: false
        });

        datasets.push({
            label: `${s.label.split(':')[1].trim()} —trend y=${(s.slope||0).toFixed(3)}x + ${(s.intercept||0).toFixed(2)} (R²=${(s.r2||0).toFixed(2)})`,
            data: s.predicted,
            borderColor: `hsl(${(i*60)%360},85%,35%)`,
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
            tension: 0
        });
    });

    predictChartInstance = new Chart(ctx, {
        type,
        data: { labels: cleanedLabels, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false } },
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { title: { display: true, text: formatAxisLabel(document.getElementById('predictX').value) },
                ticks: {
                    callback: function (value) {
                        const label = this.getLabelForValue(value);
                        const processed = shouldStripTime ? cleanDateLabel(label) : label;
                        const maxLength = 20;
                        return processed.length > maxLength ? processed.substring(0, maxLength) + '…' : processed;
                    },
                    autoSkip: true } },
                y: { title: { display: true, text: yTitle }, beginAtZero: false }
            }
        }
    });

    [btnPredictPNG, btnPredictPDF].forEach(b => {
        b.disabled = false;
        b.classList.add('active');
    });
    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const btnPredictPNG = document.getElementById('predictBtnDownloadPNG');
const btnPredictPDF = document.getElementById('predictBtnDownloadPDF');

btnPredictPNG.addEventListener('click', async () => {
    if (!predictChartInstance) return alert('No chart to download');
    const canvas = predictChartInstance.canvas;
    const ctx = canvas.getContext('2d');

    const original = ctx.getImageData(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const link = document.createElement('a');
    link.download = `predictive_chart_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png', 1);
    link.click();

    ctx.putImageData(original, 0, 0);
});

btnPredictPDF.addEventListener('click', async () => {
    if (!predictChartInstance) return alert('No chart to download');
    const canvas = predictChartInstance.canvas;
    const imgData = canvas.toDataURL('image/png', 1);

    const jspdfGlobal = window.jspdf;
    if (!jspdfGlobal) {
      alert('PDF export requires jsPDF loaded (umd).');
      return;
    }
    const { jsPDF } = jspdfGlobal;
    const pdf = new jsPDF({ orientation: 'landscape' });

    const pageW = pdf.internal.pageSize.getWidth();
    const margin = 10;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height / canvas.width) * imgW;

    pdf.text('Predictive Analysis', margin, 12);
    pdf.addImage(imgData, 'PNG', margin, 16, imgW, imgH);
    pdf.save(`predictive_chart_${Date.now()}.pdf`);
});

function showPreview(data) {
    const w = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');

    function cleanDateLabel(value) {
        if (typeof value !== "string") return value;
        return value.replace(/\s*00:00(:00)?$/, "");
    }

    function allTimesAreMidnight(values) {
        const datetimePattern = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/;
        const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
        let hasDateTime = false;
        let allMidnight = true;

        for (const v of values) {
            if (typeof v !== "string") continue;
            if (dateOnlyPattern.test(v)) continue;
            if (datetimePattern.test(v)) {
                hasDateTime = true;
                if (!v.match(/\s00:00(:00)?$/)) {
                    allMidnight = false;
                    break;
                }
            }
        }
        return hasDateTime && allMidnight;
    }

    let html = `
    <html>
    <head>
        <title>Preview ${data.table.toUpperCase()}</title>
        <meta charset="utf-8">
        <link rel="stylesheet" href="style/preview.css">
    </head>
    <body>
        <h3>${data.table.toUpperCase()}</h3>
    `;

    html += `
    <div class="legend-box">
        <span class="legend-item"><span class="legend-swatch swatch-missing"></span> Missing Data Row</span>
        <span class="legend-item"><span class="legend-swatch swatch-duplicate"></span> Duplicate Row</span>
        <span class="legend-item"><span class="legend-swatch swatch-outlier"></span> Outlier Row</span>
    </div>`;

    html += `<div class="table-container"><table><thead><tr>`;
    data.columns.forEach(c => {
        html += `<th>${c.name}<span class="small">${c.type}</span></th>`;
    });
    html += `</tr></thead><tbody>`;

    const midnightColumns = {};
    data.columns.forEach((col, i) => {
        if (col.type === 'DATETIME') {
            const values = data.rows.map(r => {
                if (Array.isArray(r)) return r[i];
                if (r && typeof r === 'object') {
                    if (col.name && r.hasOwnProperty(col.name)) return r[col.name];
                    if (col.orig && r.hasOwnProperty(col.orig)) return r[col.orig];
                    const ks = Object.keys(r);
                    return ks.length ? r[ks[0]] : undefined;
                }
                return undefined;
            });
            if (allTimesAreMidnight(values)) midnightColumns[i] = true;
        }
    });

    data.rows = data.rows || [];
    const dupSet = new Set(data.duplicates || []);
    const outliers = data.outliers || {};

    const displayedRows = 100;
    const totalRows = data.rows.length;

    function rowToArray(r) {
        if (Array.isArray(r)) return r;
        if (!r || typeof r !== 'object') return [r];
        return data.columns.map(col => {
            if (col && col.name && r.hasOwnProperty(col.name)) return r[col.name];
            if (col && col.orig && r.hasOwnProperty(col.orig)) return r[col.orig];
            return null;
        });
    }

    function getRowType(rowIndex) {
        let hasMissing = false;
        let hasOutlier = false;
        const isDuplicate = dupSet.has(rowIndex);

        const r = rowToArray(data.rows[rowIndex] || []);
        for (let i = 0; i < r.length; i++) {
            const v = r[i];
            const colName = data.columns[i] && data.columns[i].name;
            if (v === null || v === undefined || v === '') hasMissing = true;
            if (outliers[rowIndex] && colName && outliers[rowIndex][colName]) hasOutlier = true;
        }

        if (isDuplicate) return 'duplicate';
        if (hasOutlier) return 'outlier';
        if (hasMissing) return 'missing';
        return null;
    }

    data.rows.slice(0, displayedRows).forEach((r, rowIndex) => {
        const rowType = getRowType(rowIndex);
        let rowCls = '';
        if (rowType === 'duplicate') rowCls = 'row-duplicate';
        else if (rowType === 'outlier') rowCls = 'row-outlier';
        else if (rowType === 'missing') rowCls = 'row-missing';

        html += `<tr class="${rowCls}">`;
        const rowArr = rowToArray(r);
        for (let colIndex = 0; colIndex < data.columns.length; colIndex++) {
            const v = rowArr[colIndex];
            const colType = data.columns[colIndex] && data.columns[colIndex].type;
            let displayVal = v;
            if (colType === 'DATETIME' && typeof v === 'string') {
                displayVal = cleanDateLabel(v);
            }
            html += `<td>${displayVal === null ? '<i>null</i>' : String(displayVal)}</td>`;
        }
        html += `</tr>`;
    });

    const anomalyRows = [];
    for (let i = displayedRows; i < totalRows; i++) {
        const rowType = getRowType(i);
        if (rowType) anomalyRows.push({ index: i, type: rowType });
    }

    if (anomalyRows.length > 0) {
        html += `<tr><td colspan="${data.columns.length}" style="background:#ccc;height:4px;"></td></tr>`;
        for (const { index, type } of anomalyRows) {
            const rowCls = type === 'duplicate' ? 'row-duplicate'
                        : type === 'outlier'   ? 'row-outlier'
                        : 'row-missing';
            html += `<tr class="${rowCls}">`;
            const rowArr = rowToArray(data.rows[index]);
            for (let colIndex = 0; colIndex < data.columns.length; colIndex++) {
                const v = rowArr[colIndex];
                const colType = data.columns[colIndex] && data.columns[colIndex].type;
                let displayVal = v;
                if (colType === 'DATETIME' && typeof v === 'string') {
                    displayVal = cleanDateLabel(v);
                }
                html += `<td>${displayVal === null ? '<i>null</i>' : String(displayVal)}</td>`;
            }
            html += `</tr>`;
        }
    }

    html += `
        </tbody>
        </table>
        </div>
        <p class="small">Showing ${Math.min(100, data.rows.length)}${anomalyRows.length > 0 ? ` + ${anomalyRows.length}` : ``} rows.</p>
    </body>
    </html>`;

    w.document.write(html);
    w.document.close();
}

document.getElementById('btnGenerateReport').addEventListener('click', async () => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const margin = 30;
    let y = margin;

    const reportStatus = document.getElementById('reportStatus');
    reportStatus.textContent = 'Generating report... Please wait';

    function addTitle(text) {
        pdf.setFontSize(16);
        pdf.setTextColor(25, 118, 210);
        pdf.text(text, margin, y);
        y += 20;
    }

    function addTextBlock(text, fontSize = 12) {
        pdf.setFontSize(fontSize);
        pdf.setTextColor(0, 0, 0);
        const lines = pdf.splitTextToSize(text, 530);
        pdf.text(lines, margin, y);
        y += lines.length * (fontSize + 4);
    }

    async function addCanvasImage(canvasId, label) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || canvas.style.display === 'none') return;
        addTitle(label);
        const img = canvas.toDataURL('image/png', 1.0);
        const pageWidth = pdf.internal.pageSize.getWidth();
        const imgWidth = pageWidth - margin * 2;
        const imgHeight = (canvas.height / canvas.width) * imgWidth;
        if (y + imgHeight > pdf.internal.pageSize.getHeight() - margin) {
            pdf.addPage();
            y = margin;
        }
        pdf.addImage(img, 'PNG', margin, y, imgWidth, imgHeight);
        y += imgHeight + 20;
    }

    function ensureSpace(requiredHeight = 100) {
        const pageHeight = pdf.internal.pageSize.getHeight();
        if (y + requiredHeight > pageHeight - margin) {
            pdf.addPage();
            y = margin;
        }
    }

    try {
        const summaryCard = document.querySelector('#globalSummary');
        if (summaryCard && summaryCard.style.display !== 'none') {
            addTitle('Global Summary');

            const tableEl = summaryCard.querySelector('.summary-box table');
            if (tableEl) {
                const headers = [...tableEl.querySelectorAll('thead th')].map(th => th.innerText.trim());
                const rows = [...tableEl.querySelectorAll('tbody tr')].map(tr => {
                    const cells = [...tr.querySelectorAll('th, td')];
                    return cells.map(cell => cell.innerText.trim());
                });

                pdf.autoTable({
                    head: [headers],
                    body: rows,
                    startY: y,
                    styles: { fontSize: 10, cellPadding: 4 },
                    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
                    bodyStyles: { cellWidth: 'expand', minCellHeight: 10 },
                    didParseCell: function (data) {
                        if ((data.section === 'head' || data.section === 'body') && data.column.index > 0) {
                            data.cell.styles.halign = 'center';
                        }
                        if (data.section === 'head' || data.column.index === 0) data.cell.styles.fontSize = 7;
                    },
                    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
                    alternateRowStyles: { fillColor: [245, 247, 250] },
                    pageBreak: 'auto',
                    margin: { top: 40, left: 30, right: 30, bottom: 30 }
                });

                y = pdf.lastAutoTable.finalY + 20;
            } else addTextBlock('No summary data.');

            const insight = document.querySelector('#summary-insight')?.textContent?.trim();
            if (insight) addTextBlock('Insight: ' + insight);
        }

        const pageHeight = pdf.internal.pageSize.getHeight();
        const safeMargin = 40;

        if (y + 100 > pageHeight - safeMargin) {
            pdf.addPage();
            y = margin;
        }

        const corrCard = document.querySelector('#correlationMatrix');
        if (corrCard && corrCard.style.display !== 'none') {
            ensureSpace(120);
            addTitle('Correlation Matrix');
            const corrTable = corrCard.querySelector('.matrix-box table');
            if (corrTable) {
                const headers = [...corrTable.querySelectorAll('thead th')].map(th => th.innerText.trim());
                const rows = [...corrTable.querySelectorAll('tbody tr')].map(tr => {
                    const cells = [...tr.querySelectorAll('th, td')];
                    return cells.map(cell => cell.innerText.trim());
                });

                pdf.autoTable({
                    head: [headers],
                    body: rows,
                    startY: y,
                    styles: { fontSize: 10, cellPadding: 2 },
                    headStyles: { fillColor: [25, 118, 210], textColor: 255 },
                    bodyStyles: { cellWidth: 'expand', minCellHeight: 10 },
                    didParseCell: function (data) {
                        if ((data.section === 'head' || data.section === 'body') && data.column.index > 0) {
                            data.cell.styles.halign = 'center';
                        }
                        if (data.section === 'head' || data.column.index === 0) data.cell.styles.fontSize = 7;
                    },
                    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
                    alternateRowStyles: { fillColor: [248, 250, 252] },
                    pageBreak: 'auto',
                    margin: { top: 40, left: 30, right: 30, bottom: 30 }
                });

                y = pdf.lastAutoTable.finalY + 20;
            } else addTextBlock('No correlation data.');

            const insight = document.querySelector('#correlation-insight')?.textContent?.trim();
            if (insight) addTextBlock('Insight: ' + insight);
        }

        const chartInsight = document.querySelector('#chart-insight')?.textContent?.trim();
        if (chartInsight && chartInsight !== 'Getting insights ...') {
            ensureSpace(300);
            await addCanvasImage('chartCanvas', 'Data Analysis Chart');
            addTextBlock('Insight: ' + chartInsight);
        }

        const predictInsight = document.querySelector('#predict-insight')?.textContent?.trim();
        if (predictInsight && predictInsight !== 'Getting insights ...') {
            ensureSpace(300);
            await addCanvasImage('predictChartCanvas', 'Predictive Analysis Chart');
            addTextBlock('Insight: ' + predictInsight);
        }

        const filename = `AnalyChecks_Report_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
        pdf.save(filename);
        reportStatus.textContent = '✅ Report generated successfully';

        setTimeout(() => {
            reportStatus.textContent = '';
        }, 5000);
    } catch (err) {
        reportStatus.textContent = `❌ Failed to generate report: ${err}`;
        setTimeout(() => {
            reportStatus.textContent = '';
        }, 5000);
    }
});