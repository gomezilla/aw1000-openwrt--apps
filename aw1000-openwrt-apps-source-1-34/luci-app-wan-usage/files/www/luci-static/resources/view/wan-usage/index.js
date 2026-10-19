'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require dom';

var callInfo = rpc.declare({ object: 'luci.wan-usage', method: 'info' });
var callHistory = rpc.declare({ object: 'luci.wan-usage', method: 'history' });
var callManage = rpc.declare({ object: 'luci.wan-usage', method: 'manage', params: [ 'action', 'cycle_start' ] });
var callSmsTest = rpc.declare({ object: 'luci.wan-usage', method: 'sms_test', params: [ 'phone_number' ] });
var callSave = rpc.declare({
	object: 'luci.wan-usage', method: 'save',
	params: [ 'source', 'wan_interface', 'cellular_interface', 'wan_allowance_bytes', 'cellular_allowance_bytes', 'reset_day', 'wan_warn_percent', 'cellular_warn_percent', 'sms_enabled', 'phone_number', 'cellular_cap_action', 'history_days' ]
});

function bytesLabel(bytes) {
	var n = Number(bytes || 0);
	if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
	if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
	if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
	return n.toLocaleString() + ' B';
}

function parseDay(value) {
	var p = String(value || '').split('-').map(Number);
	return p.length === 3 && p[0] && p[1] && p[2] ? new Date(p[0], p[1] - 1, p[2]) : null;
}

function displayDate(date) {
	return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function displayDay(value) {
	var date = parseDay(value);
	return date ? displayDate(date) : value;
}

function calendarDayNumber(date) {
	return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function dayKey(date) {
	return [ date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0') ].join('-');
}

function cycleBounds(resetDay, today) {
	var d = today || new Date(), requested = Math.max(1, Math.min(31, Number(resetDay) || 1));
	function clamp(y, m) { return new Date(y, m, Math.min(requested, new Date(y, m + 1, 0).getDate())); }
	var start = clamp(d.getFullYear(), d.getMonth()), end;
	if (d.getDate() < start.getDate()) start = clamp(d.getFullYear(), d.getMonth() - 1);
	end = clamp(start.getFullYear(), start.getMonth() + 1);
	var last = new Date(end); last.setDate(last.getDate() - 1);
	return { start: start, end: end, last: last, startKey: dayKey(start), lastKey: dayKey(last), resetKey: dayKey(end) };
}

function cycleLabel(resetDay) {
	var b = cycleBounds(resetDay);
	return _('%s – %s; resets %s').format(displayDate(b.start), displayDate(b.last), displayDate(b.end));
}

function normalizePhone(value) {
	var number = String(value || '').trim().replace(/[\s().-]/g, '');
	if (number.indexOf('00') === 0) number = number.slice(2);
	if (number.indexOf('+') === 0) number = number.slice(1);
	return number;
}

function sumRows(rows) {
	return rows.reduce(function(a, row) {
		a.down += Number(row.down_bytes || 0); a.up += Number(row.up_bytes || 0); a.days++;
		return a;
	}, { down: 0, up: 0, days: 0 });
}

function setContent(parent, children) {
	while (parent.firstChild)
		parent.removeChild(parent.firstChild);

	function append(item) {
		if (Array.isArray(item)) {
			item.forEach(append);
		}
		else if (item != null) {
			parent.appendChild(item.nodeType ? item : document.createTextNode(String(item)));
		}
	}

	append(children);
	return parent;
}

return view.extend({
	load: function() { return callInfo(); },

	render: function(data) {
		var source = E('select', { id: 'usage-source' }, [
			E('option', { value: 'wan' }, _('Wired WAN')),
			E('option', { value: 'cellular' }, _('Cellular')),
			E('option', { value: 'both' }, _('Both (separate totals and allowances)'))
		]);
		var interfaceNames = (data.interfaces || []).slice(), linkFields = {};
		var reset = E('select', { id: 'usage-reset' }, Array.from({ length: 31 }, function(_, i) { return E('option', { value: String(i + 1) }, String(i + 1)); }));
		var smsEnabled = E('input', { id: 'usage-sms-enabled', type: 'checkbox' });
		var phone = E('input', { id: 'usage-sms-phone', type: 'tel', placeholder: '639XXXXXXXXX', maxlength: '24', autocomplete: 'tel' });
		var capAction = E('select', { id: 'usage-cellular-cap-action' }, [
			E('option', { value: 'none' }, _('Nothing — just show it here')),
			E('option', { value: 'stop' }, _('Stop mobile data until the period resets'))
		]);
		var historyDays = E('input', { id: 'usage-history-days', type: 'number', min: '1', max: '3650', step: '1' });
		var output = E('div', { 'class': 'alert-message' });
		var smsTestStatus = E('p', { 'class': 'usage-note' });
		var status = E('div', { 'class': 'usage-overview' });
		var historyPanel = E('div', { 'class': 'usage-history' });
		var overviewDaily = E('div', { 'class': 'usage-recent' });
		var range = E('select', { id: 'usage-range' }, [
			[ 'period', _('This billing period') ], [ 'month', _('This calendar month') ], [ '7', _('Last 7 days') ], [ '30', _('Last 30 days') ], [ 'all', _('Everything recorded') ]
		].map(function(x) { return E('option', { value: x[0] }, x[1]); }));

		function interfaceSelect(link, selected) {
			var detected = link === 'cellular' ? data.cellular_device : data.wan_device;
			var options = [ E('option', { value: 'auto' }, detected ? _('Automatic (%s)').format(detected) : _('Automatic (waiting for interface)')) ];
			interfaceNames.forEach(function(name) { options.push(E('option', { value: name }, _('Manual: %s').format(name))); });
			var field = E('select', { id: 'usage-' + link + '-device' }, options);
			field.value = selected && (selected === 'auto' || interfaceNames.indexOf(selected) !== -1) ? selected : 'auto';
			return field;
		}

		function allowanceFields(link, bytes) {
			var val = Number(bytes || 0), unit = val >= 1e12 ? 'TB' : val >= 1e9 ? 'GB' : val >= 1073741824 ? 'GiB' : val >= 1048576 ? 'MiB' : 'MB';
			var scale = { MB: 1e6, GB: 1e9, TB: 1e12, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
			var amount = E('input', { id: 'usage-' + link + '-allowance', type: 'number', min: '0', step: 'any', value: val ? (val / scale[unit]).toString() : '0' });
			var units = E('select', { id: 'usage-' + link + '-units' }, [ 'MB', 'GB', 'TB', 'MiB', 'GiB', 'TiB' ].map(function(item) { return E('option', { value: item }, item); }));
			units.value = unit;
			return { amount: amount, units: units };
		}

		[ 'wan', 'cellular' ].forEach(function(link) {
			var title = link === 'wan' ? _('Wired WAN') : _('Cellular');
			var allowance = allowanceFields(link, data[link + '_allowance_bytes'] || (data.source === link ? data.allowance_bytes : 0));
			var device = interfaceSelect(link, data[link + '_interface'] || (data.source === link ? data.interface : 'auto'));
			var warning = E('input', { id: 'usage-' + link + '-warning', type: 'number', min: '1', max: '99', value: data[link + '_warn_percent'] || (data.source === link ? data.warn_percent : '80') || '80' });
			var panel = E('section', { 'class': 'cbi-section', id: 'usage-' + link + '-settings' }, [
				E('h3', {}, title),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: device.id }, _('Network interface')), E('div', { 'class': 'cbi-value-field' }, device) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: allowance.amount.id }, _('Data allowance per period')), E('div', { 'class': 'cbi-value-field' }, [ allowance.amount, allowance.units, E('p', { 'class': 'cbi-value-description' }, _('Enter 0 for an unmetered plan. MB/GB/TB are decimal units; MiB/GiB/TiB are binary units.')) ]) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: warning.id }, _('Warn at (% of allowance)')), E('div', { 'class': 'cbi-value-field' }, warning) ])
			]);
			linkFields[link] = { device: device, allowance: allowance, warning: warning, panel: panel };
		});

		source.value = data.source || 'wan';
		function updatePanels() {
			linkFields.wan.panel.style.display = source.value === 'cellular' ? 'none' : '';
			linkFields.cellular.panel.style.display = source.value === 'wan' ? 'none' : '';
			capPanel.style.display = source.value === 'wan' ? 'none' : '';
		}
		reset.value = data.reset_day || '1';
		smsEnabled.checked = data.sms_enabled === '1'; phone.value = data.phone_number || '';
		capAction.value = data.cellular_cap_action || 'none'; historyDays.value = data.history_days || '400';

		function activeSources(info) { return info.source === 'both' ? [ 'wan', 'cellular' ] : [ info.source === 'cellular' ? 'cellular' : 'wan' ]; }
		function linkTitle(name) { return name === 'cellular' ? _('Cellular') : _('Wired WAN'); }

		function drawStatus(info) {
			data = info;
			if (linkFields.wan.device.value === 'auto') linkFields.wan.device.options[0].textContent = info.wan_device ? _('Automatic (%s)').format(info.wan_device) : _('Automatic (waiting for interface)');
			if (linkFields.cellular.device.value === 'auto') linkFields.cellular.device.options[0].textContent = info.cellular_device ? _('Automatic (%s)').format(info.cellular_device) : _('Automatic (waiting for interface)');
			var bounds = cycleBounds(info.reset_day || 1), sources = activeSources(info), nodes = [];
			sources.forEach(function(link) {
				var used = Number(info[link + '_used_bytes'] || (info.source === link ? info.used_bytes : 0) || 0);
				var cap = Number(info[link + '_allowance_bytes'] || (info.source === link ? info.allowance_bytes : 0) || 0);
				var pct = cap > 0 ? used * 100 / cap : 0, warn = Number(info[link + '_warn_percent'] || 80);
				var tracked = info[link + '_tracked_device'] || info[link + '_device'] || '';
				var available = info[link + '_available'];
				var today = new Date(); today.setHours(0, 0, 0, 0);
				var daysElapsed = Math.max(1, calendarDayNumber(today) - calendarDayNumber(bounds.start) + 1);
				var cycleDays = Math.max(1, calendarDayNumber(bounds.end) - calendarDayNumber(bounds.start));
				var projected = used / daysElapsed * cycleDays;
				var statusText = _('No warning at this time.'), statusClass = 'usage-chip';
				if (available === false) statusText = _('Interface unavailable');
				else if (cap > 0 && pct >= 100) { statusText = _('Allowance reached'); statusClass += ' usage-danger'; }
				else if (cap > 0 && pct >= warn) { statusText = _('Warning threshold reached'); statusClass += ' usage-warn'; }
				else if (cap > 0) statusText = _('Uplink up');
				var card = E('section', { 'class': 'usage-card' }, [
					E('div', { 'class': 'usage-headline' }, [
						E('div', {}, [ E('strong', {}, bytesLabel(used)), cap > 0 ? E('span', {}, _(' of %s').format(bytesLabel(cap))) : E('span', {}, _(' used')) ]),
						cap > 0 ? E('strong', { 'class': 'usage-percent' }, Math.floor(pct) + '%') : E('strong', { 'class': 'usage-percent' }, '—')
					])
				]);
				if (cap > 0) {
					var bar = E('div', { 'class': 'usage-progress' + (pct >= 100 ? ' usage-over' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, pct)), 'aria-valuetext': _('%s% used; reminder at %s%').format(Math.floor(pct), warn), title: _('Reminder threshold: %s%').format(warn) }, [ E('span', { style: 'width:' + Math.min(100, pct) + '%' }) ]);
					bar.appendChild(E('i', { style: 'left:' + warn + '%', 'aria-hidden': 'true' }));
					card.appendChild(bar);
					card.appendChild(E('div', { 'class': 'usage-meter-labels' }, [ E('span', {}, used < cap ? _('%s left').format(bytesLabel(cap - used)) : _('%s over').format(bytesLabel(used - cap))), E('span', {}, _('%s day(s) left — resets %s').format(Math.max(0, calendarDayNumber(bounds.end) - calendarDayNumber(today)), displayDate(bounds.end))) ]));
				}
				var chips = [ E('span', { 'class': 'usage-chip' }, cycleLabel(info.reset_day || 1)), E('span', { 'class': 'usage-chip' }, tracked ? _('Uplink up · %s').format(tracked) : _('Waiting for interface')) ];
				if (cap > 0) chips.push(E('span', { 'class': statusClass }, statusText));
				if (info.sms_enabled === '1') chips.push(E('span', { 'class': 'usage-chip' }, _('Texts %s').format(info.phone_number || '')));
				card.appendChild(E('div', { 'class': 'usage-chips' }, chips));
				if (cap > 0 && available !== false) card.appendChild(E('p', { 'class': projected > cap ? 'usage-projection usage-danger' : 'usage-projection', title: _('Projection carries this period’s average daily usage through the end of the billing period.') }, _('On course for %s').format(bytesLabel(projected)) + (projected > cap ? _(' — over the allowance') : '')));
				if (available === false) card.appendChild(E('p', { 'class': 'usage-note' }, _('The saved total is kept while this interface is disconnected.')));
				nodes.push(E('div', { 'class': 'usage-source-block' }, [ E('h3', {}, linkTitle(link)), card ]));
			});
			setContent(status, nodes);
		}

		function rangeStart(value) {
			var now = new Date(); now.setHours(0,0,0,0);
			if (value === 'period') return cycleBounds(data.reset_day || 1).startKey;
			if (value === 'month') return dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
			if (value === '7' || value === '30') { now.setDate(now.getDate() - Number(value) + 1); return dayKey(now); }
			return '0000-00-00';
		}

		function drawDailyOverview(rows) {
			var sources = activeSources(data), cutoff = rangeStart(range.value), container = [];
			sources.forEach(function(name) {
				var chosen = rows.filter(function(r) { return r.source === name && r.date >= cutoff; }).sort(function(a,b) { return b.date.localeCompare(a.date); });
				var totals = sumRows(chosen), count = Math.max(1, totals.days), tableRows = chosen.map(function(row) {
					var total = Number(row.down_bytes || 0) + Number(row.up_bytes || 0);
					return E('tr', {}, [ E('th', {}, displayDay(row.date) + (row.date === dayKey(new Date()) ? _(' (today)') : '')), E('td', {}, bytesLabel(total)), E('td', {}, bytesLabel(row.down_bytes)), E('td', {}, bytesLabel(row.up_bytes)), E('td', {}, E('span', { 'class': 'usage-share' }, E('i', { style: 'width:' + (totals.down + totals.up ? Math.max(2, total / (totals.down + totals.up) * 100) : 0) + '%' }))) ]);
				});
				container.push(E('div', { 'class': 'usage-source-block' }, [
					E('h3', {}, linkTitle(name)),
					E('div', { 'class': 'usage-stats' }, [
						metric(_('This selection'), totals.down + totals.up), metric(_('Downloaded'), totals.down), metric(_('Uploaded'), totals.up), metric(_('Per day'), (totals.down + totals.up) / count)
					]),
					chosen.length ? E('table', { 'class': 'table usage-table' }, [ E('thead', {}, E('tr', {}, [ E('th', {}, _('Day')), E('th', {}, _('Total')), E('th', {}, _('Down')), E('th', {}, _('Up')), E('th', {}, _('Share')) ])), E('tbody', {}, tableRows) ]) : E('p', {}, _('No daily records in this range yet.'))
				]));
			});
			setContent(overviewDaily, [ E('div', { 'class': 'usage-range-control' }, [ E('label', { 'for': range.id }, _('Show')), range ]) ].concat(container));
		}

		function metric(label, value) { return E('div', { 'class': 'usage-metric' }, [ E('span', {}, label), E('strong', {}, bytesLabel(value)) ]); }

		function drawHistory(result) {
			var rows = result && result.days || [], sources = activeSources(data), nodes = [];
			sources.forEach(function(name) {
				var grouped = {};
				rows.filter(function(row) { return row.source === name; }).forEach(function(row) {
					var month = row.date.slice(0,7), down = Number(row.down_bytes || 0), up = Number(row.up_bytes || 0);
					if (!grouped[month]) grouped[month] = { down: 0, up: 0, days: 0, busiest: 0 };
					grouped[month].down += down; grouped[month].up += up; grouped[month].days++; grouped[month].busiest = Math.max(grouped[month].busiest, down + up);
				});
				var months = Object.keys(grouped).sort().reverse(), maxMonth = Math.max(1, ...months.map(function(m) { return grouped[m].down + grouped[m].up; }));
				var body = months.map(function(month) {
					var x = grouped[month], total = x.down + x.up, nameDate = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)) - 1, 1);
					return E('tr', {}, [ E('th', {}, _('%s (%s day(s))').format(nameDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), x.days)), E('td', {}, bytesLabel(total)), E('td', {}, bytesLabel(x.down)), E('td', {}, bytesLabel(x.up)), E('td', {}, bytesLabel(total / x.days)), E('td', {}, bytesLabel(x.busiest)), E('td', {}, E('span', { 'class': 'usage-share' }, E('i', { style: 'width:' + Math.max(2, total / maxMonth * 100) + '%' }))) ]);
				});
				nodes.push(E('div', { 'class': 'usage-source-block' }, [ E('h3', {}, linkTitle(name)), months.length ? E('table', { 'class': 'table usage-table' }, [ E('thead', {}, E('tr', {}, [ E('th', {}, _('Month')), E('th', {}, _('Total')), E('th', {}, _('Down')), E('th', {}, _('Up')), E('th', {}, _('Per day')), E('th', {}, _('Busiest day')), E('th', {}, _('Share')) ])), E('tbody', {}, body) ]) : E('p', {}, _('No history recorded yet.')) ]));
			});
			var historyMeta = result && result.meta || {}, allRows = rows.filter(function(r) { return sources.indexOf(r.source) !== -1; });
			var dates = allRows.map(function(r) { return r.date; }).sort(), metaRows = [
				[ _('Recorded'), dates.length ? _('%s day(s), %s to %s').format(dates.length, displayDay(dates[0]), displayDay(dates[dates.length - 1])) : _('No days recorded yet') ],
				[ _('Kept for'), (data.history_days || 400) + _(' days') ],
				[ _('Stored in'), '/etc/wan-usage/*-daily.csv' ],
				[ _('History file size'), bytesLabel(historyMeta.bytes || 0) ],
				[ _('Not yet written'), bytesLabel(historyMeta.pending_bytes || 0) ],
				[ _('Written every'), (historyMeta.write_seconds || 60) + _(' second(s)') ],
				[ _('Sampled every'), (historyMeta.sample_seconds || 60) + _(' second(s)') ]
			].map(function(r) { return E('div', { 'class': 'usage-meta-row' }, [ E('span', {}, r[0]), E('strong', {}, r[1]) ]); });
			var bounds = cycleBounds(data.reset_day || 1);
			var actions = E('div', { 'class': 'usage-history-actions' }, [
				E('div', {}, [ E('button', { 'class': 'btn usage-destructive', type: 'button', click: function() { manage('reset_period', bounds.startKey, _('Start this billing period again? This clears its current totals and current-period daily rows, while leaving earlier history alone.')); } }, _('Start this period again')), E('p', {}, _('Starting again clears what this billing period has counted and leaves the months before it alone — useful after a plan top-up or when tracking began partway through a period.')) ]),
				E('button', { 'class': 'btn usage-destructive', type: 'button', click: function() { manage('forget_all', bounds.startKey, _('Forget all tracked totals and daily history for both links? This cannot be undone.')); } }, _('Forget everything'))
			]);
			setContent(historyPanel, [ E('p', { 'class': 'usage-intro' }, _('Every calendar month with anything recorded, newest first. A calendar month is not the billing period unless the plan resets on the 1st — Overview counts the period, this tab counts the month.')) ].concat(nodes, [ E('div', { 'class': 'usage-meta' }, [ E('h4', {}, _('Where this is kept')) ].concat(metaRows)), actions ]));
			drawDailyOverview(rows);
		}

		function manage(action, start, promptText) {
			if (!confirm(promptText)) return;
			output.textContent = _('Updating usage records…');
			return callManage(action, start).then(function(result) {
				if (!result || !result.ok) throw new Error(result && result.error || _('Could not update usage records.'));
				output.textContent = action === 'forget_all' ? _('Usage history and totals cleared.') : _('This billing period has been restarted.');
				return callInfo().then(function(info) { data = info; drawStatus(info); return refreshHistory(); });
			}).catch(function(err) { output.textContent = err.message || _('Could not update usage records.'); });
		}

		function sendTestSms() {
			var number = normalizePhone(phone.value);
			if (!number) {
				smsTestStatus.textContent = _('Enter a phone number first.');
				return;
			}
			smsTest.disabled = true;
			smsTestStatus.textContent = _('Sending test SMS through the modem…');
			return callSmsTest(number).then(function(result) {
				smsTestStatus.textContent = result && result.message || (result && result.ok ? _('The modem accepted the test SMS. Carrier delivery is not confirmed.') : _('The modem could not send the test SMS.'));
			}).catch(function(err) {
				smsTestStatus.textContent = err.message || _('Could not contact the SMS service.');
			}).finally(function() { smsTest.disabled = false; });
		}

		function refreshHistory() { return callHistory().then(drawHistory).catch(function() { historyPanel.textContent = _('Unable to load usage history.'); }); }
		drawStatus(data); refreshHistory();
		poll.add(function() { return callInfo().then(function(info) { drawStatus(info); return refreshHistory(); }); }, 60);
		range.addEventListener('change', function() { refreshHistory(); });

		var save = E('button', { 'class': 'btn cbi-button cbi-button-save' }, _('Save & Apply'));
		save.addEventListener('click', function() {
			save.disabled = true; output.textContent = _('Saving…');
			return callSave(source.value, linkFields.wan.device.value, linkFields.cellular.device.value,
				String(Math.round(Math.max(0, Number(linkFields.wan.allowance.amount.value) || 0) * ({ MB:1e6, GB:1e9, TB:1e12, MiB:1048576, GiB:1073741824, TiB:1099511627776 }[linkFields.wan.allowance.units.value]))),
				String(Math.round(Math.max(0, Number(linkFields.cellular.allowance.amount.value) || 0) * ({ MB:1e6, GB:1e9, TB:1e12, MiB:1048576, GiB:1073741824, TiB:1099511627776 }[linkFields.cellular.allowance.units.value]))), reset.value,
				linkFields.wan.warning.value, linkFields.cellular.warning.value, smsEnabled.checked ? '1' : '0', normalizePhone(phone.value), capAction.value, historyDays.value
			).then(function(result) {
				if (!result || !result.ok) throw new Error(result && result.error || _('Save failed.'));
				output.textContent = _('Settings saved. Usage tracking is active.');
				return callInfo().then(function(info) { drawStatus(info); return refreshHistory(); });
			}).catch(function(err) { output.textContent = err.message || _('Unable to save settings.'); }).finally(function() { save.disabled = false; });
		});

		var smsTest = E('button', { 'class': 'btn', type: 'button' }, _('Send test SMS'));
		smsTest.addEventListener('click', sendTestSms);
		var capPanel = E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: capAction.id }, _('When the cellular allowance is used up')), E('div', { 'class': 'cbi-value-field' }, [ capAction, E('p', { 'class': 'cbi-value-description' }, _('Stopping mobile data applies only to cellular. It takes the AW1000 mobile network interfaces down until the billing period resets; wired WAN is left alone.')) ]) ]);
		source.addEventListener('change', updatePanels); updatePanels();
		var settingsPanel = E('section', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Settings')),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: 'usage-source' }, _('Track usage on')), E('div', { 'class': 'cbi-value-field' }, source) ]),
			linkFields.wan.panel, linkFields.cellular.panel,
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: 'usage-reset' }, _('Reset day of month')), E('div', { 'class': 'cbi-value-field' }, [ reset, E('p', { 'class': 'cbi-value-description' }, _('If a month is shorter than the selected day, the period resets on its last day.')) ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: 'usage-sms-enabled' }, _('Send SMS alerts')), E('div', { 'class': 'cbi-value-field' }, [ smsEnabled, E('p', { 'class': 'cbi-value-description' }, _('Send one SMS per link at its warning threshold and one at 100% of its allowance. Failed sends are retried at most every 30 minutes; an unconfirmed modem code 350 is treated as sent to avoid duplicates.')) ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: 'usage-sms-phone' }, _('SMS phone number')), E('div', { 'class': 'cbi-value-field' }, [ phone, E('p', { 'class': 'cbi-value-description' }, _('Use international digits, such as 639XXXXXXXXX, without a leading +. A local number beginning with 0 uses the modem country-code setting.')), smsTest, smsTestStatus ]) ]),
			capPanel,
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title', for: historyDays.id }, _('Data retention (days)')), E('div', { 'class': 'cbi-value-field' }, [ historyDays, E('p', { 'class': 'cbi-value-description' }, _('Keep this many daily records per tracked link. Older days are removed during sampling.')) ]) ]),
			E('div', { 'class': 'cbi-page-actions' }, [ save, output ])
		]);

		var panels = { overview: E('div', { 'class': 'usage-tab-panel' }, [ status, overviewDaily ]), history: E('div', { 'class': 'usage-tab-panel', style: 'display:none' }, [ historyPanel ]), settings: E('div', { 'class': 'usage-tab-panel', style: 'display:none' }, [ settingsPanel ]) };
		var buttons = {};
		var tabbar = E('div', { 'class': 'usage-tabs' }, [ 'overview', 'history', 'settings' ].map(function(name) {
			var button = E('button', { 'class': 'btn usage-tab', type: 'button' }, _(name.charAt(0).toUpperCase() + name.slice(1)));
			buttons[name] = button;
			button.addEventListener('click', function() {
				Object.keys(panels).forEach(function(key) { panels[key].style.display = key === name ? '' : 'none'; buttons[key].classList.toggle('active', key === name); });
				if (name === 'history') refreshHistory();
			});
			return button;
		}));
		buttons.overview.classList.add('active');
		return E('div', { 'class': 'wan-usage' }, [
			E('link', { rel: 'stylesheet', href: L.resource('wan-usage/style.css') }),
			E('h2', {}, _('Data Usage')),
			tabbar, panels.overview, panels.history, panels.settings
		]);
	}
});
