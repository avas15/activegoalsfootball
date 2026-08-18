/* Active Goals CRM. Authenticated admin-only extension; public collections stay untouched. */
(function () {
    'use strict';

    if (typeof auth === 'undefined' || typeof db === 'undefined') return;

    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const COLLECTIONS = ['players', 'venues', 'sessions', 'attendance', 'payments', 'warnings', 'awards'];
    const state = window.AGF_CRM = {
        players: [], venues: [], sessions: [], attendance: [], payments: [], warnings: [], awards: [],
        weekStart: monday(new Date()), loaded: false, loading: false
    };
    let receiptReady = false;
    let toastTimer;

    function $(id) { return document.getElementById(id); }
    function esc(value) {
        if (typeof window.escHtml === 'function') return window.escHtml(String(value == null ? '' : value));
        const div = document.createElement('div'); div.textContent = String(value == null ? '' : value); return div.innerHTML;
    }
    function today() { return isoDate(new Date()); }
    function isoDate(date) {
        const d = new Date(date); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    }
    function parseDate(value) { const parts = String(value).split('-').map(Number); return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(value); }
    function addDays(value, amount) { const d = parseDate(value); d.setDate(d.getDate() + amount); return isoDate(d); }
    function monday(date) { const d = new Date(date); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return isoDate(d); }
    function weekLabel(value) { return parseDate(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function nowIso() { return new Date().toISOString(); }
    function playerName(id) { const p = state.players.find(x => x.id === id); return String(p?.childName || 'Unknown player'); }
    function sessionName(id) { const s = state.sessions.find(x => x.id === id); return String(s?.name || 'Unknown session'); }
    function venueName(id) { const v = state.venues.find(x => x.id === id); return String(v?.name || 'No venue'); }
    function stamp(value) { if (!value) return ''; if (typeof value === 'string') return value; if (value.toDate) return value.toDate().toISOString(); return String(value); }
    function toast(message, type) {
        let el = $('agf-toast');
        if (!el) { el = document.createElement('div'); el.id = 'agf-toast'; el.className = 'crm-toast'; document.body.appendChild(el); }
        el.className = 'crm-toast' + (type ? ' ' + type : ''); el.textContent = message;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), type === 'error' ? 6000 : 2600);
    }
    function receipt(title, details) {
        if (!window.emailjs) return;
        if (!receiptReady) { window.emailjs.init('6Ry00HeIIDR3eMwnh'); receiptReady = true; }
        window.emailjs.send('service_a0h8z98', 'template_7at96wm', {
            from_name: 'AGF Admin', from_email: 'activegoalsfootball@gmail.com', from_phone: '',
            session_type: title, message: details + '\n' + new Date().toLocaleString('en-GB')
        }).catch(() => console.log('AGF receipt email failed'));
    }
    function dateInRange(value) {
        const range = $('agf-payment-range')?.value || 'all';
        if (range === 'all') return true;
        const d = parseDate(value); const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), range === 'month' ? 1 : now.getMonth() - 2, 1);
        return d >= start && d <= now;
    }
    function tracker(playerId) {
        const rows = state.attendance.filter(x => x.playerId === playerId && ['present', 'late'].includes(x.status));
        const minutes = rows.reduce((sum, row) => sum + (Number(state.sessions.find(x => x.id === row.sessionId)?.durationMin) || 0), 0);
        const warnings = state.warnings.filter(x => x.playerId === playerId && !x.resolved).length;
        const awards = state.awards.filter(x => x.playerId === playerId).length;
        return { sessions: rows.length, minutes, warnings, awards, ledger: ledger(playerId) };
    }
    function ledger(playerId) {
        const p = state.players.find(x => x.id === playerId) || {};
        const all = state.attendance.filter(x => ['present', 'late'].includes(x.status)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const first = {};
        all.forEach(row => { if (!(row.playerId in first)) first[row.playerId] = row.id; });
        const rows = all.filter(row => dateInRange(row.date));
        const groups = {};
        rows.forEach(row => {
            const child = state.players.find(x => x.id === row.playerId) || {};
            const key = row.sessionId + '|' + row.date + '|' + String(child.guardianEmail || '').trim().toLowerCase();
            (groups[key] ||= []).push(row);
        });
        let owed = 0;
        Object.values(groups).forEach(group => {
            const chargeable = group.filter(row => first[row.playerId] !== row.id);
            if (!chargeable.some(row => row.playerId === playerId)) return;
            const session = state.sessions.find(x => x.id === group[0].sessionId) || {};
            const price = Number(session.price) || 0;
            const total = chargeable.length > 1 ? price + 5 : price * chargeable.length;
            owed += total / chargeable.length;
        });
        const payments = state.payments.filter(x => x.playerId === playerId && dateInRange(x.date));
        const paid = payments.filter(x => x.kind !== 'discount').reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
        const discounts = payments.filter(x => x.kind === 'discount').reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
        return { owed, paid, discounts, outstanding: owed - paid - discounts };
    }
    async function loadCRM() {
        if (state.loading) return; state.loading = true;
        try {
            const result = await Promise.all(COLLECTIONS.map(name => db.collection(name).get()));
            COLLECTIONS.forEach((name, i) => { state[name] = result[i].docs.map(doc => ({ id: doc.id, ...doc.data() })); });
            if (!state.venues.length) {
                const ref = db.collection('venues').doc();
                const data = { name: 'Wigmore Primary School', address: 'Twyford Drive, Luton', notes: 'Outdoor field', active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
                await ref.set(data); state.venues.push({ id: ref.id, name: data.name, address: data.address, notes: data.notes, active: true });
            }
            state.loaded = true; renderAll();
        } catch (error) {
            console.error('CRM load failed:', error); toast(error.code === 'permission-denied' ? 'CRM rules need authenticated access' : 'CRM could not load', 'error');
        } finally { state.loading = false; }
    }
    async function mutate(title, details, apply, rollback, write) {
        apply(); renderAll(); toast('Saving...', 'pending');
        try { await write(); receipt(title, details); toast('Saved: ' + details); }
        catch (error) { if (rollback) rollback(); renderAll(); console.error('CRM save failed:', error); toast(error.code === 'permission-denied' ? 'Save blocked by Firestore rules' : 'Could not save change', 'error'); }
    }
    function renderAll() {
        if (!state.loaded) return;
        $('agf-week-label').textContent = 'Week of ' + weekLabel(state.weekStart);
        renderRoster(); renderPlayers(); renderVenues(); renderSessions(); populateSelects(); renderPayments(); renderWarnings(); renderAwards(); renderRetention();
    }
    function populateSelects() {
        const activePlayers = state.players.filter(x => x.status !== 'left').sort((a, b) => String(a.childName || '').localeCompare(String(b.childName || '')));
        const playerOptions = '<option value="">Choose player</option>' + activePlayers.map(p => `<option value="${esc(p.id)}">${esc(p.childName)}</option>`).join('');
        ['agf-payment-player', 'agf-warning-player', 'agf-award-player'].forEach(id => { const el = $(id); if (el && !el.matches(':focus')) el.innerHTML = playerOptions; });
        const sessionOptions = '<option value="">Choose session</option>' + state.sessions.filter(x => x.active !== false).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
        const paymentSession = $('agf-payment-session'); if (paymentSession && !paymentSession.matches(':focus')) paymentSession.innerHTML = '<option value="">Any session</option>' + sessionOptions.replace('<option value="">Choose session</option>', '');
        const daySelect = $('agf-session-day'); if (daySelect && !daySelect.options.length) daySelect.innerHTML = DAYS.map(day => `<option>${day}</option>`).join('');
        const venueSelect = $('agf-session-venue'); if (venueSelect && !venueSelect.matches(':focus')) venueSelect.innerHTML = '<option value="">No venue</option>' + state.venues.filter(x => x.active !== false).map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
    }

    // Players
    const consentKeys = [['risk', 'agf-consent-risk'], ['codeOfConduct', 'agf-consent-code'], ['medical', 'agf-consent-medical'], ['photo', 'agf-consent-photo'], ['collection', 'agf-consent-collection'], ['endOfSession', 'agf-consent-end'], ['declaration', 'agf-consent-declaration']];
    function agfOpenPlayerForm(id) {
        const p = id ? state.players.find(x => x.id === id) : {};
        $('agf-player-editor').hidden = false; $('agf-player-editor-title').textContent = id ? 'Edit Player' : 'Add Player'; $('agf-player-id').value = id || '';
        const fields = { 'agf-child-name': p.childName, 'agf-child-dob': p.childDob, 'agf-child-age': p.childAge, 'agf-child-gender': p.childGender, 'agf-child-school': p.childSchool, 'agf-guardian-name': p.guardianName, 'agf-guardian-email': p.guardianEmail, 'agf-guardian-phone': p.guardianPhone, 'agf-emergency-name': p.emergencyName, 'agf-emergency-phone': p.emergencyPhone, 'agf-medical-notes': p.medicalNotes, 'agf-player-notes': p.notes };
        Object.entries(fields).forEach(([field, value]) => $(field).value = value || '');
        consentKeys.forEach(([key, field]) => $(field).checked = !!p.consents?.[key]?.granted);
        $('agf-player-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function agfClosePlayerForm() { $('agf-player-editor').hidden = true; }
    async function agfSavePlayer() {
        const id = $('agf-player-id').value; const existing = state.players.find(x => x.id === id) || {};
        const name = $('agf-child-name').value.trim(); if (!name) return alert('Enter the child\'s name.');
        const consents = {}; consentKeys.forEach(([key, field]) => { const old = existing.consents?.[key] || {}; consents[key] = { granted: $(field).checked, at: $(field).checked ? (old.at || nowIso()) : (old.at || '') }; });
        const data = { guardianEmail: $('agf-guardian-email').value.trim(), guardianName: $('agf-guardian-name').value.trim(), guardianPhone: $('agf-guardian-phone').value.trim(), childName: name, childAge: $('agf-child-age').value, childDob: $('agf-child-dob').value, childGender: $('agf-child-gender').value.trim(), childSchool: $('agf-child-school').value.trim(), medicalNotes: $('agf-medical-notes').value.trim(), emergencyName: $('agf-emergency-name').value.trim(), emergencyPhone: $('agf-emergency-phone').value.trim(), consents, status: existing.status || 'active', leftAt: existing.leftAt || '', retentionExtended: !!existing.retentionExtended, notes: $('agf-player-notes').value.trim() };
        const ref = id ? db.collection('players').doc(id) : db.collection('players').doc(); const local = { id: ref.id, ...existing, ...data, updatedAt: nowIso(), createdAt: existing.createdAt || nowIso() }; const previous = state.players.slice();
        state.players = id ? state.players.map(x => x.id === id ? local : x) : [...state.players, local]; agfClosePlayerForm(); renderAll(); toast('Saving player...', 'pending');
        try { await ref.set({ ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), ...(id ? {} : { createdAt: firebase.firestore.FieldValue.serverTimestamp() }) }); receipt(id ? 'Player updated: ' + name : 'Player added: ' + name, 'Player record saved.'); toast('Saved: ' + name); }
        catch (error) { state.players = previous; renderAll(); toast(error.code === 'permission-denied' ? 'Save blocked by Firestore rules' : 'Could not save player', 'error'); }
    }
    async function agfArchivePlayer(id) {
        const p = state.players.find(x => x.id === id); if (!p || !confirm('Archive ' + p.childName + '? History will stay intact.')) return;
        const previous = state.players.slice(); state.players = state.players.map(x => x.id === id ? { ...x, status: 'left', leftAt: today() } : x); renderAll();
        try { await db.collection('players').doc(id).update({ status: 'left', leftAt: today(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); receipt('Player archived: ' + p.childName, 'Player was marked as left.'); toast('Archived: ' + p.childName); }
        catch (error) { state.players = previous; renderAll(); toast('Could not archive player', 'error'); }
    }
    function renderPlayers() {
        const list = $('agf-players-list'); if (!list) return; const query = ($('agf-player-search').value || '').toLowerCase(); const filter = $('agf-player-filter').value;
        const items = state.players.filter(p => (filter === 'all' || (filter === 'left' ? p.status === 'left' : p.status !== 'left')) && String(p.childName || '').toLowerCase().includes(query)).sort((a, b) => String(a.childName).localeCompare(String(b.childName)));
        list.innerHTML = items.length ? items.map(p => { const t = tracker(p.id); return `<div class="crm-card"><div class="crm-card-header"><div><div class="crm-card-title">${esc(p.childName || 'Unnamed')}</div><div class="crm-meta">${esc(p.guardianName || '')} ${p.guardianPhone ? '· ' + esc(p.guardianPhone) : ''}<br>${esc(p.guardianEmail || '')}${p.status === 'left' ? ' · Left ' + esc(p.leftAt || '') : ''}</div></div><div class="crm-inline"><span class="crm-badge ${t.warnings >= 3 ? 'warn' : ''}">${t.warnings} warnings</span><span class="crm-badge award">${t.awards} awards</span></div></div><div class="crm-meta">${p.medicalNotes ? '<strong>Medical:</strong> ' + esc(p.medicalNotes) : 'No medical notes recorded'}</div><div class="tracker-grid"><div class="tracker-stat"><strong>${t.sessions}</strong><span>sessions</span></div><div class="tracker-stat"><strong>${t.minutes}</strong><span>minutes</span></div><div class="tracker-stat"><strong>£${t.ledger.outstanding.toFixed(2)}</strong><span>indicative due</span></div><div class="tracker-stat"><strong>${t.awards}</strong><span>awards</span></div></div><div class="crm-actions"><button onclick="agfOpenPlayerForm('${esc(p.id)}')">Edit</button>${p.status !== 'left' ? `<button class="crm-danger" onclick="agfArchivePlayer('${esc(p.id)}')">Archive</button>` : ''}</div></div>`; }).join('') : '<div class="crm-empty">No players match.</div>';
    }
    function renderRetention() {
        const list = $('agf-retention-list'); if (!list) return; const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12);
        const items = state.players.filter(p => p.status === 'left' && p.leftAt && parseDate(p.leftAt) <= cutoff && !p.retentionExtended);
        list.innerHTML = items.length ? items.map(p => `<div class="crm-card"><div class="crm-card-title">${esc(p.childName)}</div><div class="crm-meta">Left ${esc(p.leftAt)}. Review retention now.</div><div class="crm-actions"><button onclick="agfExtendRetention('${esc(p.id)}')">Extend 1 month (re-confirmed)</button></div></div>`).join('') : '<div class="crm-empty">Nothing due for retention review.</div>';
    }
    async function agfExtendRetention(id) { const p = state.players.find(x => x.id === id); if (!p) return; await mutate('Retention extended: ' + p.childName, 'Retention review extended by one month.', () => { state.players = state.players.map(x => x.id === id ? { ...x, retentionExtended: true } : x); }, null, () => db.collection('players').doc(id).update({ retentionExtended: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })); }

    // Venues and sessions
    function agfOpenVenueForm(id) { const v = state.venues.find(x => x.id === id) || {}; $('agf-venue-editor').hidden = false; $('agf-venue-id').value = id || ''; $('agf-venue-name').value = v.name || ''; $('agf-venue-address').value = v.address || ''; $('agf-venue-notes').value = v.notes || ''; $('agf-venue-active').checked = v.active !== false; }
    function agfCloseVenueForm() { $('agf-venue-editor').hidden = true; }
    async function agfSaveVenue() { const id = $('agf-venue-id').value; const name = $('agf-venue-name').value.trim(); if (!name) return alert('Enter a venue name.'); const existing = state.venues.find(x => x.id === id) || {}; const data = { name, address: $('agf-venue-address').value.trim(), notes: $('agf-venue-notes').value.trim(), active: $('agf-venue-active').checked }; const ref = id ? db.collection('venues').doc(id) : db.collection('venues').doc(); const previous = state.venues.slice(); state.venues = id ? state.venues.map(x => x.id === id ? { ...x, ...data } : x) : [...state.venues, { id: ref.id, ...data }]; agfCloseVenueForm(); renderAll(); try { await ref.set({ ...data, createdAt: existing.createdAt || firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); receipt('Venue saved: ' + name, data.address); toast('Saved: ' + name); } catch (error) { state.venues = previous; renderAll(); toast('Could not save venue', 'error'); } }
    function renderVenues() { const list = $('agf-venues-list'); if (!list) return; list.innerHTML = state.venues.length ? state.venues.map(v => `<div class="crm-card"><div class="crm-card-header"><div><div class="crm-card-title">${esc(v.name)}</div><div class="crm-meta">${esc(v.address || '')}<br>${esc(v.notes || '')}</div></div><span class="crm-badge">${v.active === false ? 'Archived' : 'Active'}</span></div><div class="crm-actions"><button onclick="agfOpenVenueForm('${esc(v.id)}')">Edit</button>${v.active !== false ? `<button class="crm-danger" onclick="agfArchiveVenue('${esc(v.id)}')">Archive</button>` : ''}</div></div>`).join('') : '<div class="crm-empty">No venues yet.</div>'; }
    async function agfArchiveVenue(id) { const v = state.venues.find(x => x.id === id); if (!v || !confirm('Archive ' + v.name + '?')) return; await mutate('Venue archived: ' + v.name, 'Venue was marked inactive.', () => { state.venues = state.venues.map(x => x.id === id ? { ...x, active: false } : x); }, null, () => db.collection('venues').doc(id).update({ active: false })); }
    function agfOpenSessionForm(id) { const s = state.sessions.find(x => x.id === id) || {}; $('agf-session-editor').hidden = false; $('agf-session-id').value = id || ''; $('agf-session-name').value = s.name || ''; $('agf-session-day').value = s.dayOfWeek || 'Saturday'; $('agf-session-time').value = s.startTime || ''; $('agf-session-duration').value = s.durationMin || 90; $('agf-session-price').value = s.price == null ? 10 : s.price; $('agf-session-order').value = s.order || state.sessions.length + 1; $('agf-session-active').checked = s.active !== false; $('agf-session-venue').value = s.venueId || ''; }
    function agfCloseSessionForm() { $('agf-session-editor').hidden = true; }
    async function agfSaveSession() { const id = $('agf-session-id').value; const name = $('agf-session-name').value.trim(); if (!name) return alert('Enter a session name.'); const data = { name, dayOfWeek: $('agf-session-day').value, startTime: $('agf-session-time').value.trim(), durationMin: Number($('agf-session-duration').value) || 90, venueId: $('agf-session-venue').value, price: Number($('agf-session-price').value) || 0, active: $('agf-session-active').checked, order: Number($('agf-session-order').value) || 1 }; const ref = id ? db.collection('sessions').doc(id) : db.collection('sessions').doc(); const previous = state.sessions.slice(); state.sessions = id ? state.sessions.map(x => x.id === id ? { ...x, ...data } : x) : [...state.sessions, { id: ref.id, ...data }]; agfCloseSessionForm(); renderAll(); try { await ref.set(data, { merge: true }); receipt('Session saved: ' + name, data.dayOfWeek + ' ' + data.startTime + ' at ' + venueName(data.venueId)); toast('Saved: ' + name); } catch (error) { state.sessions = previous; renderAll(); toast('Could not save session', 'error'); } }
    function renderSessions() { const list = $('agf-sessions-list'); if (!list) return; const sorted = state.sessions.slice().sort((a, b) => (a.order || 0) - (b.order || 0)); list.innerHTML = sorted.length ? sorted.map(s => `<div class="crm-card"><div class="crm-card-header"><div><div class="crm-card-title">${esc(s.name)}</div><div class="crm-meta">${esc(s.dayOfWeek)} · ${esc(s.startTime)} · ${Number(s.durationMin) || 0} minutes<br>${esc(venueName(s.venueId))} · £${(Number(s.price) || 0).toFixed(2)}</div></div><span class="crm-badge">${s.active === false ? 'Archived' : 'Active'}</span></div><div class="crm-actions"><button onclick="agfOpenSessionForm('${esc(s.id)}')">Edit</button></div></div>`).join('') : '<div class="crm-empty">No CRM sessions yet. Add Wigmore or another weekly session.</div>'; }

    // Weekly roster
    function sessionDate(session) { const index = Math.max(0, DAYS.indexOf(session.dayOfWeek)); return addDays(state.weekStart, index); }
    function agfShiftWeek(amount) { state.weekStart = addDays(state.weekStart, amount * 7); renderRoster(); }
    function agfTodayWeek() { state.weekStart = monday(new Date()); renderRoster(); }
    function agfAssignChild(select, sessionId) { const playerId = select.value; if (!playerId) return; const existing = state.attendance.find(x => x.playerId === playerId && x.sessionId === sessionId && x.weekStart === state.weekStart); select.value = ''; if (existing) return toast('Already assigned this week'); const session = state.sessions.find(x => x.id === sessionId); const ref = db.collection('attendance').doc(); const data = { playerId, sessionId, date: sessionDate(session), weekStart: state.weekStart, status: 'expected', markedAt: firebase.firestore.FieldValue.serverTimestamp() }; state.attendance.push({ id: ref.id, ...data, markedAt: nowIso() }); renderRoster(); ref.set(data).then(() => { receipt('Player assigned: ' + playerName(playerId), playerName(playerId) + ' assigned to ' + sessionName(sessionId)); toast('Saved: ' + playerName(playerId)); }).catch(() => { state.attendance = state.attendance.filter(x => x.id !== ref.id); renderRoster(); toast('Could not assign player', 'error'); }); }
    async function agfCycleAttendance(id) { const row = state.attendance.find(x => x.id === id); if (!row) return; const next = { expected: 'present', present: 'absent', absent: 'late', late: 'expected' }[row.status] || 'expected'; const old = row.status; row.status = next; row.markedAt = nowIso(); renderRoster(); try { await db.collection('attendance').doc(id).update({ status: next, markedAt: firebase.firestore.FieldValue.serverTimestamp() }); receipt('Attendance updated: ' + playerName(row.playerId), playerName(row.playerId) + ': ' + old + ' to ' + next); toast('Saved: ' + next); } catch (error) { row.status = old; renderRoster(); toast('Could not update attendance', 'error'); } }
    async function agfRemoveAttendance(id) { const row = state.attendance.find(x => x.id === id); if (!row || !confirm('Remove ' + playerName(row.playerId) + ' from this week?')) return; const previous = state.attendance.slice(); state.attendance = state.attendance.filter(x => x.id !== id); renderRoster(); try { await db.collection('attendance').doc(id).delete(); receipt('Roster assignment removed', playerName(row.playerId) + ' removed from ' + sessionName(row.sessionId)); toast('Removed from roster'); } catch (error) { state.attendance = previous; renderRoster(); toast('Could not remove assignment', 'error'); } }
    async function agfCopyLastWeek(sessionId) { const oldWeek = addDays(state.weekStart, -7); const rows = state.attendance.filter(x => x.sessionId === sessionId && x.weekStart === oldWeek); if (!rows.length) return toast('No previous roster to copy', 'error'); const session = state.sessions.find(x => x.id === sessionId); const batch = db.batch(); const additions = []; rows.forEach(row => { if (state.attendance.some(x => x.sessionId === sessionId && x.playerId === row.playerId && x.weekStart === state.weekStart)) return; const ref = db.collection('attendance').doc(); const data = { playerId: row.playerId, sessionId, date: sessionDate(session), weekStart: state.weekStart, status: 'expected', markedAt: firebase.firestore.FieldValue.serverTimestamp() }; batch.set(ref, data); additions.push({ id: ref.id, ...data, markedAt: nowIso() }); }); if (!additions.length) return toast('Everyone is already assigned'); state.attendance.push(...additions); renderRoster(); try { await batch.commit(); receipt('Roster copied', additions.length + ' players copied to ' + sessionName(sessionId)); toast('Copied ' + additions.length + ' players'); } catch (error) { state.attendance = state.attendance.filter(x => !additions.some(y => y.id === x.id)); renderRoster(); toast('Could not copy roster', 'error'); } }
    function renderRoster() { const list = $('agf-roster-list'); if (!list) return; $('agf-week-label').textContent = 'Week of ' + weekLabel(state.weekStart); const sessions = state.sessions.filter(x => x.active !== false).sort((a, b) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) || (a.order || 0) - (b.order || 0)); list.innerHTML = sessions.length ? sessions.map(s => { const rows = state.attendance.filter(x => x.sessionId === s.id && x.weekStart === state.weekStart).sort((a, b) => playerName(a.playerId).localeCompare(playerName(b.playerId))); const marked = rows.filter(x => x.status !== 'expected').length; const options = state.players.filter(p => p.status !== 'left' && !rows.some(r => r.playerId === p.id)).sort((a, b) => String(a.childName || '').localeCompare(String(b.childName || ''))).map(p => `<option value="${esc(p.id)}">${esc(p.childName)}</option>`).join(''); return `<div class="roster-session"><div class="roster-session-head"><div><div class="roster-session-name">${esc(s.name)}</div><div>${esc(s.dayOfWeek)} · ${esc(s.startTime)} · ${esc(venueName(s.venueId))}</div></div><div>${rows.length} assigned · ${marked} marked</div></div><div class="crm-inline" style="padding:10px 12px"><select onchange="agfAssignChild(this,'${esc(s.id)}')"><option value="">+ Add child</option>${options}</select><button class="crm-small-btn" onclick="agfCopyLastWeek('${esc(s.id)}')">Copy last week</button></div>${rows.length ? rows.map(row => `<div class="roster-row"><span class="roster-row-name">${esc(playerName(row.playerId))}</span><button class="status-chip status-${esc(row.status)}" onclick="agfCycleAttendance('${esc(row.id)}')">${esc(row.status)}</button><button class="remove-btn" style="position:static" onclick="agfRemoveAttendance('${esc(row.id)}')" aria-label="Remove">&times;</button></div>`).join('') : '<div class="crm-empty">No children assigned this week.</div>'}</div>`; }).join('') : '<div class="crm-empty">Add a session first.</div>'; }

    // Payments
    async function agfSavePayment() { const playerId = $('agf-payment-player').value; if (!playerId) return alert('Choose a player.'); const data = { playerId, sessionId: $('agf-payment-session').value || '', amount: Number($('agf-payment-amount').value) || 0, date: $('agf-payment-date').value || today(), method: $('agf-payment-method').value, kind: $('agf-payment-kind').value, note: $('agf-payment-note').value.trim(), source: 'manual', createdAt: firebase.firestore.FieldValue.serverTimestamp() }; if (!data.amount) return alert('Enter an amount.'); const ref = db.collection('payments').doc(); const local = { id: ref.id, ...data, createdAt: nowIso() }; state.payments.push(local); renderPayments(); try { await ref.set(data); receipt(data.kind === 'discount' ? 'Discount recorded' : 'Payment recorded', playerName(playerId) + ': £' + data.amount.toFixed(2)); toast('Saved payment entry'); $('agf-payment-amount').value = ''; $('agf-payment-note').value = ''; } catch (error) { state.payments = state.payments.filter(x => x.id !== ref.id); renderPayments(); toast('Could not save payment', 'error'); } }
    function renderPayments() { const list = $('agf-payments-list'); if (!list) return; const items = state.players.filter(x => x.status !== 'left' || tracker(x.id).ledger.outstanding !== 0).sort((a, b) => a.childName.localeCompare(b.childName)); list.innerHTML = items.length ? items.map(p => { const l = ledger(p.id); const entries = state.payments.filter(x => x.playerId === p.id && dateInRange(x.date)); return `<div class="crm-card"><div class="crm-card-header"><div class="crm-card-title">${esc(p.childName)}</div><span class="crm-badge ${l.outstanding > 0 ? 'warn' : ''}">£${l.outstanding.toFixed(2)} due</span></div><div class="crm-meta">Indicative owed £${l.owed.toFixed(2)} · paid £${l.paid.toFixed(2)} · discounts £${l.discounts.toFixed(2)}</div>${entries.length ? `<div class="crm-meta" style="margin-top:8px">${entries.map(x => `${esc(x.date)} · ${x.kind === 'discount' ? 'Discount' : 'Payment'} £${Number(x.amount).toFixed(2)}${x.note ? ' · ' + esc(x.note) : ''}`).join('<br>')}</div>` : ''}</div>`; }).join('') : '<div class="crm-empty">No payment records yet.</div>'; }

    // Warnings and awards
    async function agfSaveWarning() { const playerId = $('agf-warning-player').value; const note = $('agf-warning-note').value.trim(); if (!playerId || !note) return alert('Choose a player and enter a note.'); const data = { playerId, type: $('agf-warning-type').value, note, resolved: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() }; const ref = db.collection('warnings').doc(); state.warnings.push({ id: ref.id, ...data, createdAt: nowIso() }); renderAll(); try { await ref.set(data); receipt('Warning added: ' + playerName(playerId), data.type + ': ' + note); toast('Warning saved'); $('agf-warning-note').value = ''; } catch (error) { state.warnings = state.warnings.filter(x => x.id !== ref.id); renderAll(); toast('Could not save warning', 'error'); } }
    async function agfResolveWarning(id) { const row = state.warnings.find(x => x.id === id); if (!row) return; row.resolved = true; row.resolvedAt = nowIso(); renderAll(); try { await db.collection('warnings').doc(id).update({ resolved: true, resolvedAt: firebase.firestore.FieldValue.serverTimestamp() }); receipt('Warning resolved', playerName(row.playerId)); toast('Warning resolved'); } catch (error) { row.resolved = false; renderAll(); toast('Could not resolve warning', 'error'); } }
    function renderWarnings() { const list = $('agf-warnings-list'); if (!list) return; const rows = state.warnings.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); list.innerHTML = rows.length ? rows.map(x => `<div class="crm-card"><div class="crm-card-header"><div><div class="crm-card-title">${esc(playerName(x.playerId))}</div><div class="crm-meta">${esc(x.type)} · ${esc(stamp(x.createdAt).slice(0, 10))}</div></div><span class="crm-badge ${x.resolved ? '' : 'warn'}">${x.resolved ? 'Resolved' : 'Open'}</span></div><div class="crm-meta">${esc(x.note)}</div>${x.resolved ? '' : `<div class="crm-actions"><button onclick="agfResolveWarning('${esc(x.id)}')">Resolve</button></div>`}</div>`).join('') : '<div class="crm-empty">No warnings recorded.</div>'; }
    async function agfSaveAward() { const playerId = $('agf-award-player').value; const label = $('agf-award-label').value.trim(); if (!playerId || !label) return alert('Choose a player and enter an award.'); const data = { playerId, label, note: $('agf-award-note').value.trim(), awardedAt: firebase.firestore.FieldValue.serverTimestamp() }; const ref = db.collection('awards').doc(); state.awards.push({ id: ref.id, ...data, awardedAt: nowIso() }); renderAll(); try { await ref.set(data); receipt('Award added: ' + playerName(playerId), label); toast('Award saved'); $('agf-award-label').value = ''; $('agf-award-note').value = ''; } catch (error) { state.awards = state.awards.filter(x => x.id !== ref.id); renderAll(); toast('Could not save award', 'error'); } }
    function renderAwards() { const list = $('agf-awards-list'); if (!list) return; list.innerHTML = state.awards.length ? state.awards.slice().sort((a, b) => String(b.awardedAt).localeCompare(String(a.awardedAt))).map(x => `<div class="crm-card"><div class="crm-card-header"><div><div class="crm-card-title">${esc(playerName(x.playerId))}</div><div class="crm-meta">${esc(stamp(x.awardedAt).slice(0, 10))}</div></div><span class="crm-badge award">Award</span></div><div class="crm-meta"><strong>${esc(x.label)}</strong>${x.note ? '<br>' + esc(x.note) : ''}</div></div>`).join('') : '<div class="crm-empty">No awards yet.</div>'; }

    function agfExportData() { const replacer = (key, value) => value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value; const data = {}; COLLECTIONS.forEach(name => data[name] = state[name]); const blob = new Blob([JSON.stringify(data, replacer, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'agf-backup-' + today() + '.json'; link.click(); URL.revokeObjectURL(link.href); receipt('CRM backup exported', 'All CRM collections downloaded as JSON.'); toast('Backup downloaded'); }

    Object.assign(window, { agfOpenPlayerForm, agfClosePlayerForm, agfSavePlayer, agfArchivePlayer, agfRenderPlayers: renderPlayers, agfOpenVenueForm, agfCloseVenueForm, agfSaveVenue, agfArchiveVenue, agfOpenSessionForm, agfCloseSessionForm, agfSaveSession, agfShiftWeek, agfTodayWeek, agfAssignChild, agfCycleAttendance, agfRemoveAttendance, agfCopyLastWeek, agfSavePayment, agfSaveWarning, agfResolveWarning, agfSaveAward, agfExportData });

    if (db.enablePersistence) db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    auth.onAuthStateChanged(user => { if (user) loadCRM(); else { state.loaded = false; state.players = []; state.venues = []; state.sessions = []; state.attendance = []; state.payments = []; state.warnings = []; state.awards = []; } });
})();
