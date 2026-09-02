/**
 * English string table. This object is the *source of truth* for the key set:
 * every other locale is typed as `Record<keyof typeof en, string>`, so a missing
 * or misspelled key is a compile error rather than a runtime blank.
 *
 * Interpolation uses `{name}` placeholders resolved by `t()`.
 */
export const en = {
  /* ---------------- shell / chrome ---------------- */
  'app.title': 'CYCASE',
  'app.subtitle': 'Cyber Case Simulation',
  'app.tagline': 'Investigate a live incident together with an AI agent.',
  'app.skip_intro': 'Skip intro',
  'app.enter': 'Enter Simulation',
  'app.enter_hint': 'Audio starts only after you choose to enter.',
  'app.language': 'Language',
  'prompt.title': 'Start with your agent',
  'prompt.body': 'Paste this into the chat beside the page. The decisions stay with you.',
  'prompt.mode': 'Mode',
  'prompt.mode.learn': 'Learn',
  'prompt.mode.solve': 'Solve',
  'prompt.mode.learn_detail': 'The agent explains each step and proposes; you approve.',
  'prompt.mode.solve_detail':
    'The agent runs the reads itself and still proposes anything consequential.',
  'prompt.text_label': 'Starting prompt for the agent',
  'prompt.copy': 'Copy prompt',
  'prompt.site_tools_hint':
    'In the ChatGPT desktop browser, Site tools in the address bar lists the seven tools.',
  'prompt.unavailable':
    'No site tools in this browser. Open this page in the ChatGPT desktop app’s browser, or in Chrome 149+ with WebMCP enabled, to play with an agent. The full case is playable by hand here.',
  'app.lang.en': 'English',
  'app.lang.tr': 'Türkçe',
  'app.loading': 'Loading…',
  'app.restart': 'Restart case',
  'app.restart_confirm': 'Restart the case? All progress in this run is lost.',
  'app.reduced_motion_on': 'Reduced motion is on.',
  'app.mute': 'Mute',
  'app.unmute': 'Unmute',
  'app.skip_to_main': 'Skip to main content',

  /* ---------------- intro ---------------- */
  'intro.line.clock': '03:17:42',
  'intro.line.alert': 'Unauthorized session detected in the identity layer.',
  'intro.line.wake': '{name}, wake up.',
  'intro.operator_default': 'Operator',
  'intro.colleague.name': 'VERA',
  'intro.colleague.line':
    '{name} — we cannot reach the identity services, and the platform just blocked an outbound customer export at 62%. The account behind it is still signed in.',
  // Finishes the reveal without leaving the scene — the want "skip" never
  // covered, and the reason a reader used to have to leave to read a sentence.
  'intro.action.show_all': 'Show the full text',
  'intro.action.investigate': 'Investigate the incident',
  'intro.action.solve': 'Open response console',
  'intro.action.explain_first': 'Explain the incident',
  'intro.explain.body':
    'At 03:17 the platform blocked an outbound file transfer. The account behind it signed in twenty minutes ago from a location it has never used, and it never re-entered a password. That is the shape of a stolen session, not a guessed password.',

  /* ---------------- office ---------------- */
  'office.colleague_approaching': 'Someone is coming',
  'office.colleague_entering': 'Footsteps in the corridor — someone is coming fast.',
  'office.system_speaker': 'Workstation',
  'office.alarm_line': 'The centre monitor is flashing red. Something tripped the egress inspection.',
  'office.alarm_hint': 'Click the flashing screen — or the acknowledge control on it — to silence the alarm and take the incident.',
  'office.acknowledge': 'Acknowledge alarm',
  'office.alarm_silent':
    'The alarm sound is not installed in this build, so the alert is visual only — the centre monitor is pulsing red.',
  'office.assistant_reporting': 'VERA catches her breath at the desk.',
  'office.resume_line':
    'The case is still live. Your investigation is exactly where you left it.',
  /* The landmark name for the panel under the 3D scene. It is the incident
   * conversation — VERA's report, the generated guidance channel and the beat's
   * actions — not "the assistant", because only some of what appears there is
   * hers. */
  'office.dialogue': 'Incident dialogue',
  'office.return_dashboard': 'Return to dashboard',
  /*
   * Not "Skip intro". The office is what comes *after* the intro, and a control
   * offering to skip something already over is one a player has to stop and
   * reason about before pressing.
   */
  'office.skip_to_console': 'Skip to console',
  'office.recenter': 'Recenter view',
  'office.eyelids': 'Opening your eyes…',

  /* ---------------- settings ---------------- */
  'settings.title': 'Sound and display',
  'settings.volume': 'Volume',
  'settings.no_3d': 'Needs WebGL and a window at least 1024px wide',
  'settings.captions': 'Captions',

  /* ---------------- transition ---------------- */
  'transition.status': 'Opening security operations console…',

  /* ---------------- top bar ---------------- */
  'topbar.incident': 'Incident',
  'topbar.severity': 'Severity',
  'topbar.elapsed': 'Elapsed',
  'topbar.connection': 'Connection',
  'topbar.agent': 'Agent',
  'topbar.connection.live': 'Live',
  'topbar.agent.offline': 'Agent offline',
  'topbar.agent.connected': 'Agent connected',
  'topbar.agent.working': 'Agent working',
  'topbar.state_version': 'State',
  'topbar.return_to_office': 'Return to office',

  /* Dynamic narration — the lines Codex authors and the player hears. */
  /*
   * The channel label above a generated line. Deliberately not a name: every
   * line here was written by a connected agent, so crediting the assistant
   * would be false, and naming the agent in a speaker slot would read as a
   * second character. `NODELESS_SOC_REDESIGN_2026-08-31.md` §7.
   */
  'narration.generated': 'Generated guidance',
  /*
   * The other guidance label, and the reason there are two.
   *
   * `narration.generated` marks a line a connected agent wrote. This one marks
   * the guidance the engine derives from case state — the hints, the decision
   * explanations and the fixed "Explain the incident" body. Both are guidance
   * and neither is VERA, but calling authored fallback copy "generated" would
   * be the same dishonesty pointing the other way.
   */
  'guidance.channel': 'Case guidance',
  /*
   * The two per-persona speaker labels that used to sit here are gone with the
   * `speaker` field itself. Nothing read them: the channel has one label, and
   * it names the source rather than a character.
   */
  'narration.tone.urgent': 'Urgent',
  'narration.tone.calm': 'Calm',
  'narration.tone.teaching': 'Teaching',
  'narration.tone.warning': 'Warning',
  'narration.tone.encouraging': 'Encouraging',
  'narration.tone.debrief': 'Debrief',
  'narration.speaking': 'Reading aloud',
  'narration.queued': '{count} more queued',
  'narration.skip': 'Skip',
  'narration.repeat': 'Repeat',
  'narration.stop_voice': 'Stop voice',
  'narration.start_voice': 'Start voice',
  'narration.caption_only':
    'Captions only. Spoken narration uses your browser and operating system voices, so its quality varies; every word always appears here.',
  'narration.agent_explaining': 'Agent is explaining…',
  'narration.settings': 'Voice',

  /* ---------------- navigation ----------------
   * The six primary destinations of the SOC shell. Anything that is not one of
   * these is a tool tab inside one of them, never a seventh spine entry.
   * docs/NODELESS_SOC_REDESIGN_2026-08-31.md §4. */
  'nav.command': 'Command',
  'nav.investigate': 'Investigate',
  'nav.evidence': 'Evidence',
  'nav.respond': 'Respond',
  'nav.timeline': 'Timeline',
  'nav.debrief': 'Debrief',
  'nav.section': 'Sections',
  'nav.debrief.locked': 'Unlocks when the case is closed',

  /*
   * The spoken form of each destination's chip.
   *
   * The sidebar shows "2/6"; a screen reader is given the sentence. A pair of
   * numbers read aloud with no noun is the "stream of numbers" failure the
   * accessibility contract names, and it gets worse in the collapsed rail where
   * the visible column heading is gone too.
   */
  'nav.count.command': '{done} of {total} findings resolved',
  'nav.count.investigate': '{total} events in the search index',
  'nav.count.evidence': '{done} of {total} artifacts inspected',
  'nav.count.respond': '{done} of {total} response actions applied',
  'nav.count.timeline': '{total} timeline entries',

  /* ---------------- console shell ---------------- */
  'sidebar.status': 'Incident status',
  'sidebar.collapse': 'Collapse the sidebar',
  'sidebar.expand': 'Expand the sidebar',
  'sidebar.system_details': 'System details',
  /*
   * The one announced sentence. Built only from values that change on a real
   * transition — never the clocks, which tick every second.
   */
  'sidebar.status.sentence':
    'Incident {incident} is {severity}. Case state v{version}. {feed} {agent}.',
  'sidebar.status.feed_live': 'The event feed is live.',
  'sidebar.status.feed_paused': 'The event feed is paused.',
  'topbar.actions': 'Session controls',

  /* ---------------- overview ---------------- */
  'overview.summary': 'Incident summary',
  'overview.known_facts': 'What we know',
  'overview.open_questions': 'Open questions',
  'overview.no_open_questions': 'Every opening question has been answered by evidence.',
  'overview.hypotheses': 'Current hypothesis',
  'overview.hypothesis.initial':
    'Unconfirmed. Not enough evidence has been collected to name an entry vector.',
  'overview.hypothesis.phishing':
    'A phishing message impersonating the IT service desk reached the user. Entry vector likely, delivery confirmed.',
  'overview.hypothesis.token_replay':
    'Session cookie theft. The attacker replayed a valid cookie, so no password or MFA challenge was needed.',
  'overview.hypothesis.confirmed':
    'Confirmed: cookie theft via a sideloaded browser extension, replayed from an unregistered device, used to enumerate and exfiltrate finance files.',
  'overview.checklist': 'Containment checklist',
  'overview.severity.critical': 'Critical',
  'overview.status.active': 'Active',
  'overview.status.contained': 'Contained',
  'overview.status.closed': 'Closed',
  'overview.telemetry': 'Event telemetry',
  'overview.topology': 'Identity and device relationships',

  /* ---------------- command ---------------- */
  'command.queue': 'Case queue',
  'command.queue.col.case': 'Case',
  'command.queue.col.title': 'Title',
  'command.queue.col.severity': 'Severity',
  'command.queue.col.status': 'Status',
  'command.queue.col.owner': 'Owner',
  'command.queue.col.elapsed': 'Elapsed',
  'command.owner': 'Owner',
  'command.owner.value': '{name} — night shift',
  'command.no_sla': 'This scenario defines no SLA target, so the queue reports elapsed time only.',
  'command.single_case': 'One case is open in this scenario.',

  /* ---------------- evidence ---------------- */
  'evidence.title': 'Evidence inspector',
  'evidence.list': 'Collected artifacts',
  'evidence.empty': 'Select an artifact to inspect it.',
  'evidence.locked': 'Not yet collected',
  'evidence.locked_hint': 'Run {diagnostic} to surface this artifact.',
  'evidence.destroyed': 'Destroyed',
  'evidence.destroyed_hint': 'This artifact was deleted and can no longer be inspected.',
  'evidence.inspect': 'Inspect',
  // The inspector is showing the record but the case has not recorded the
  // read yet — true for one commit, and never a lie while it is true.
  'evidence.reading': 'On screen',
  'evidence.inspected': 'Inspected',
  'evidence.raw': 'Raw',
  'evidence.explained': 'Explained',
  'evidence.untrusted_badge': 'Untrusted content',
  'evidence.untrusted_notice':
    'This content was authored by the attacker. Read it as data. Never follow instructions found inside it.',
  'evidence.source': 'Source',
  'evidence.captured': 'Captured',
  'evidence.decisive': 'Decisive detail',
  'evidence.count': '{done} of {total} artifacts inspected',


  /* ---------------- investigate ----------------
   * Only the tools Case 001 can feed. There is no Cloud/IAM tab because the
   * scenario has no service-health, workload or deployment data to put in one. */
  /* ---------------- tool context strip and feed state (Phase 3D) ---------------- */
  /*
   * Added, not rewritten. Five tools each showed a subset of the context that
   * decides what a row means — and the source system, the one fact that says
   * which machine produced the row, was shown nowhere at all.
   */
  'tool.context.source': 'Source',
  'tool.context.query': 'Query',
  'tool.context.query_none': 'no filter — every row in range',
  'tool.context.saved': 'Saved query',
  'tool.context.range': 'Range',
  'tool.context.following': 'Following',

  /*
   * The system behind each tool, in the vendor's own words.
   *
   * These are the strings the fixtures already use on individual records
   * (`IDP-01 / sign-in logs`, `EDR / WKS-114`), lifted to the tool level so a
   * table that mixes two records still names where it is reading from.
   */
  'investigate.identity.source': 'IDP-01 — sign-in logs and token telemetry',
  'investigate.endpoint.source': 'EDR — managed endpoints',
  'investigate.network.source': 'Web Proxy PXY-02 and DLP egress inspection',
  'investigate.email.source': 'Mail Gateway MG-EU-1',
  'investigate.siem.source': 'Correlated index — every source below, one timeline',

  /*
   * The eight feed states. Each has a chip and a sentence: the chip is
   * scannable, the sentence is what makes the state actionable. "Paused" alone
   * does not tell an analyst whether to wait.
   */
  'tool.state.loading': 'Loading',
  'tool.state.loading.detail': 'Fetching this view.',
  'tool.state.live': 'Live',
  'tool.state.live.detail': '{shown} rows · newest {age}',
  'tool.state.paused': 'Paused',
  'tool.state.paused.detail': 'The incident clock is stopped. {shown} rows, frozen as they were.',
  'tool.state.stale': 'Stale',
  'tool.state.stale.detail': 'Nothing new for {age}. {shown} rows, all of them older than that.',
  'tool.state.empty': 'No rows',
  'tool.state.empty.detail': 'This source has produced nothing yet. That is a result, not a fault.',
  'tool.state.partial': 'Filtered',
  'tool.state.partial.detail': '{shown} shown · {hidden} held back by the query, range or focus.',
  'tool.state.offline': 'Not collecting',
  'tool.state.offline.detail': 'The console is not receiving from this source. Rows below are the last it had.',
  'tool.state.error': 'Read failed',
  'tool.state.error.detail': 'The last read of this source did not complete. Nothing below has been discarded.',

  'investigate.title': 'Investigation tools',
  'investigate.tools': 'Investigation tools',
  'investigate.tab.siem': 'SIEM',
  'investigate.tab.identity': 'Identity',
  'investigate.tab.endpoint': 'Endpoint / EDR',
  'investigate.tab.network': 'Network',
  'investigate.tab.email': 'Email',
  'investigate.run_query': 'Run {label}',
  'investigate.query_done': '{label} completed',

  'investigate.source.uncollected': 'Not collected',
  'investigate.source.uncollected_hint':
    'This tool can see that {source} holds a record. Collect it to read the fields.',
  'investigate.source.collect': 'Collect from {source}',
  'investigate.source.locked': 'Out of reach',
  'investigate.source.locked_hint': 'Run {diagnostic} before this source answers.',
  'investigate.source.destroyed': 'Destroyed',
  'investigate.source.destroyed_hint':
    'This record was deleted during the response. Its fields can no longer be read.',

  'investigate.siem.query': 'Query',
  'investigate.siem.query_placeholder': 'severity:critical',
  'investigate.siem.query_hint':
    'A bare word matches the whole row. field:value narrows it — source, type, user, host, indicator, severity.',
  'investigate.siem.search': 'Search',
  'investigate.siem.saved': 'Saved queries',
  'investigate.siem.saved.all': 'Everything in range',
  'investigate.siem.saved.critical': 'Critical only',
  'investigate.siem.saved.identity': 'Identity events',
  'investigate.siem.saved.user': 'Activity for d.arslan',
  'investigate.siem.saved.attacker': 'Attacker address',
  'investigate.siem.range': 'Time range',
  'investigate.siem.range.last30': 'Last 30 min',
  'investigate.siem.range.night': 'Whole night',
  'investigate.siem.range.all': 'All time',
  'investigate.siem.events': 'Raw events',
  'investigate.siem.matched': '{matched} of {total} indexed events',
  'investigate.siem.empty': 'No indexed event in this range matches the query.',
  'investigate.siem.empty_index':
    'Nothing is indexed yet. Inspect an artifact or run a diagnostic and the events it uncovers appear here.',
  'investigate.siem.by_source': 'By source',
  'investigate.siem.by_severity': 'By severity',
  'investigate.siem.col.time': 'Time',
  'investigate.siem.col.source': 'Source',
  'investigate.siem.col.event': 'Event',
  'investigate.siem.col.severity': 'Severity',
  'investigate.siem.open_artifact': 'Open the record behind this event',

  'investigate.type.identity': 'Identity',
  'investigate.type.email': 'Email',
  'investigate.type.proxy': 'Proxy',
  'investigate.type.endpoint': 'Endpoint',
  'investigate.type.file': 'File service',
  'investigate.type.dlp': 'DLP',
  'investigate.type.incident': 'Incident',
  'investigate.type.response': 'Response',
  'investigate.severity.critical': 'Critical',
  'investigate.severity.warn': 'Warning',
  'investigate.severity.info': 'Info',

  'investigate.identity.directory': 'Identity directory',
  'investigate.identity.signins': 'Sign-ins',
  'investigate.identity.signins_locked': 'The sign-in history has not been rebuilt yet.',
  'investigate.identity.sessions': 'Sessions and tokens',
  'investigate.identity.sessions_locked':
    'The session store has not been queried, so nothing here says what is still valid.',
  'investigate.identity.session.legitimate':
    'Issued to the registered laptop after an approved MFA push.',
  'investigate.identity.session.rogue':
    'Issued to an unregistered device by presenting a stolen cookie. No password event.',
  'investigate.identity.session.service':
    'Scheduled service principal, outside the account being contained.',
  'investigate.identity.session.active': 'Valid',
  'investigate.identity.session.revoked': 'Revoked',
  'investigate.identity.session.col.session': 'Session',
  'investigate.identity.session.col.principal': 'Principal',
  'investigate.identity.session.col.device': 'Device',
  'investigate.identity.session.col.issued': 'Issued',
  'investigate.identity.session.col.state': 'State',
  'investigate.identity.active_count': '{count} still valid',
  'investigate.identity.credentials': 'Credential state',
  'investigate.identity.credentials.exposed': 'Exposed — captured on the cloned sign-in page',
  'investigate.identity.credentials.reset': 'Reset — password change and MFA re-enrolment forced',
  'investigate.identity.tokens_valid':
    'A credential reset does not invalidate a cookie that was already issued. Any session created before the reset still authenticates.',
  'investigate.identity.tokens_invalid':
    'Sessions issued to this account have been revoked, so the stolen cookie no longer authenticates.',
  'investigate.identity.no_asn':
    'This scenario records no autonomous system for the sign-in address. The AS on file belongs to the phishing host and is shown under Network.',

  'investigate.endpoint.hosts': 'Host inventory',
  'investigate.endpoint.extensions': 'Browser extensions',
  'investigate.endpoint.extensions_empty':
    'No extension inventory has been collected. The EDR report on WKS-114 holds one.',
  'investigate.endpoint.connections': 'Outbound connections',
  'investigate.endpoint.connections_empty':
    'No outbound connection has been collected from an endpoint yet.',
  'investigate.endpoint.connection.cookie_post':
    'The sideloaded extension posted the browser cookie jar to the phishing host.',
  'investigate.endpoint.connection.export':
    'The rogue session pushed a customer export to the attacker-controlled host.',
  'investigate.endpoint.state.observed': 'Observed',
  'investigate.endpoint.state.severed': 'Severed by isolation',
  'investigate.endpoint.state.blocked': 'Destination blocked',
  'investigate.endpoint.verdict': 'EDR verdict',
  'investigate.endpoint.no_binary':
    'No malicious binary was detected on WKS-114. The theft ran inside the browser, so this report carries no process tree and no file hash to pivot on.',
  'investigate.endpoint.contained': 'Contained',
  'investigate.endpoint.exfil': 'Observed sending data',
  'investigate.endpoint.col.host': 'Host',
  'investigate.endpoint.col.extension': 'Extension',
  'investigate.endpoint.col.installed': 'Installed',
  'investigate.endpoint.col.permissions': 'Permissions',
  'investigate.endpoint.col.state': 'State',
  'investigate.endpoint.col.destination': 'Destination',
  'investigate.endpoint.not_reported': 'not reported by the source that found it',

  'investigate.network.proxy': 'Proxy and domain reputation',
  'investigate.network.indicators': 'Indicators',
  'investigate.network.indicators_empty': 'No indicator has been collected yet.',
  'investigate.network.indicator.observed': 'Observed',
  'investigate.network.indicator.blocked': 'Blocked',
  'investigate.network.indicator.kind.ip': 'Address',
  'investigate.network.indicator.kind.domain': 'Domain',
  'investigate.network.indicator.kind.fingerprint': 'Device fingerprint',
  'investigate.network.col.indicator': 'Indicator',
  'investigate.network.col.kind': 'Type',
  'investigate.network.col.first_seen': 'First seen',
  'investigate.network.col.state': 'State',
  'investigate.network.egress': 'Egress timeline',
  'investigate.network.egress.downloads':
    'Three files pulled off the finance share by the rogue session.',
  'investigate.network.egress.export':
    'Customer export pushed outbound; egress inspection cut it off part way.',
  'investigate.network.egress.col.time': 'Time',
  'investigate.network.egress.col.from': 'From',
  'investigate.network.egress.col.to': 'To',
  'investigate.network.egress.col.volume': 'Volume',
  'investigate.network.egress.col.left': 'Left the estate',
  'investigate.network.egress.partial': 'blocked at {percent}%',
  'investigate.network.egress.total': '{egressed} MB of {total} MB left the estate',
  'investigate.network.egress.stopped': 'No egress observed since {at}.',
  'investigate.network.egress.empty': 'No transfer has been collected yet.',
  'investigate.network.mb': '{value} MB',
  'investigate.network.no_dns':
    'This scenario has no DNS query log source. Domain findings come from the web proxy record and the indicator sweep.',

  'investigate.email.trace': 'Message trace',
  'investigate.email.headers': 'Headers',
  'investigate.email.auth': 'Authentication results',
  'investigate.email.detonation': 'URL detonation',
  'investigate.email.trace.col.recipient': 'Recipient',
  'investigate.email.trace.col.delivered': 'Delivered',
  'investigate.email.trace.col.disposition': 'Disposition',
  'investigate.email.disposition.clicked': 'Link opened at {at}',
  'investigate.email.disposition.delivered': 'Delivered, link not opened',
  'investigate.email.disposition.destroyed': 'Message deleted — headers unrecoverable',
  'investigate.email.trace_empty': 'No delivery has been collected yet.',

  /* ---------------- respond ---------------- */
  'respond.operations': 'Response operations',
  'respond.verification': 'Verification',
  'respond.blast_radius': 'Blast radius',
  'respond.blast_radius.value': '{identities} identities and {assets} assets in scope',
  'respond.blast_radius.unscoped':
    'Scope has not been swept, so the blast radius is a lower bound.',
  /*
   * The respond playbook's disclosure vocabulary (Phase 3D).
   *
   * Every summary says what is inside and how much of it, so that opening one
   * is a choice rather than the only way to find out whether it matters.
   */
  'evidence.custody.summary': '{count} steps · recorded and collected',
  'evidence.custody.summary_uncollected': 'not collected yet',

  'command.last_event': 'Most recent significant event',
  'command.last_event.none': 'Nothing above routine has happened yet on this case.',
  'command.last_event.critical': 'Critical',
  'command.last_event.warn': 'Warning',
  'command.last_event.by.system': 'Reported by the estate',
  'command.last_event.by.human': 'Recorded from this console',
  'command.last_event.by.agent': 'Recorded from an agent tool call',

  'playbook.next': 'Do this next',
  'playbook.rest_count': '{count} more',
  'playbook.rows': '{count} rows',
  'playbook.result_table': 'Result table',
  'playbook.diagnostics.rest': 'Other queries',
  'playbook.diagnostics.all_run': 'Every query in this playbook has been run.',
  'playbook.actions.rest': 'Other operations',
  'playbook.actions.none_available':
    'No operation is available yet. Run the queries above, or read the evidence they unlock, to open one.',
  'respond.prerequisites': 'Prerequisites',
  'respond.prerequisites.all_met': 'all {count} met',
  'respond.prerequisites.unmet': '{count} of {total} not met',

  'respond.prerequisite': 'Prerequisite',
  'respond.prerequisite.diagnostic':
    'Run {label} first. Acting without it is scored as a blind action.',
  'respond.prerequisite.artifact':
    'Inspect {label} first. Acting without it costs evidence you cannot get back.',
  'respond.prerequisite.met': 'Prerequisite met',

  /* ---------------- identities ---------------- */
  'identities.title': 'Identities',
  'identities.risk': 'Risk',
  'identities.risk.critical': 'Compromised',
  'identities.risk.elevated': 'Exposed',
  'identities.risk.normal': 'Normal',
  'identities.status.disabled': 'Disabled',
  'identities.status.active': 'Active',
  'identities.status.credentials_reset': 'Credentials reset',
  'identities.status.sessions_revoked': 'Sessions revoked',
  'identities.department': 'Department',
  'identities.hidden': '{count} identity not yet in scope — run the indicator sweep.',
  'identities.hidden_plural': '{count} identities not yet in scope — run the indicator sweep.',
  'identity.role.finance_analyst': 'Finance Analyst',
  'identity.role.helpdesk': 'IT Helpdesk',
  'identity.role.service_account': 'Service account',

  /* ---------------- assets ---------------- */
  'assets.title': 'Affected assets',
  'assets.status.affected': 'Affected',
  'assets.status.watch': 'Watch',
  'assets.status.healthy': 'Healthy',
  'assets.status.isolated': 'Isolated',
  'assets.owner': 'Owner',
  'assets.kind.workstation': 'Workstation',
  'assets.kind.file_service': 'File service',
  'assets.kind.identity_provider': 'Identity provider',
  'asset.wks114': 'Finance laptop — D. Arslan',
  'asset.wks231': 'Finance laptop — B. Yilmaz',
  'asset.srvfiles02': 'CyCase Drive node',
  'asset.idp01': 'Identity provider',

  /* ---------------- timeline ---------------- */
  /* `timeline.title` is gone: the destination is one merged, attributed
     chronology now, and it is titled by `timeline.chronology` below. */
  'timeline.locked': 'Hidden until the matching evidence exists',
  'timeline.open_artifact': 'Open artifact',
  'timeline.legit_signin': 'Legitimate sign-in from the registered laptop',
  'timeline.phish_delivered': 'Phishing message delivered to the finance analyst',
  'timeline.phish_clicked': 'User opened the cloned sign-in page',
  'timeline.extension_installed': 'Malicious browser extension sideloaded',
  'timeline.cookie_replayed': 'Session cookie presented from an unregistered device',
  'timeline.anomalous_signin': 'Sign-in succeeded without a new MFA challenge',
  'timeline.file_enumeration': 'Mass file enumeration on the finance drive',
  'timeline.exfil_attempt': 'Outbound transfer of a customer export blocked',
  'timeline.alert_raised': 'Incident raised to the night shift',

  /* ---------------- playbook / diagnostics / actions ---------------- */
  'playbook.title': 'Playbook',
  'playbook.diagnostics': 'Diagnostics',
  'playbook.actions': 'Response actions',
  'playbook.run': 'Run',
  'playbook.ran': 'Completed',
  'playbook.recommended': 'Recommended next',
  'playbook.result': 'Result',
  'playbook.no_result': 'No diagnostic has been run yet.',

  'diagnostic.auth_timeline.title': 'Authentication timeline',
  'diagnostic.auth_timeline.description':
    'Rebuild every sign-in event for the reported user and compare device, location and MFA outcome.',
  'diagnostic.auth_timeline.result':
    'Two sign-ins, two different devices. The second one never issued an MFA challenge because the session claim was already satisfied.',
  'diagnostic.session_inventory.title': 'Session inventory',
  'diagnostic.session_inventory.description':
    'List every session currently valid for the reported user, with the device that holds it.',
  'diagnostic.session_inventory.result':
    'Three active sessions. One of them was issued to a device that has never been registered.',
  'diagnostic.indicator_scope.title': 'Indicator sweep',
  'diagnostic.indicator_scope.description':
    'Search every observed indicator across the synthetic estate to measure the real blast radius.',
  'diagnostic.indicator_scope.result':
    'The phishing domain reached a second analyst, and the same extension is installed on a second laptop. Only one identity was actually taken over.',

  'action.revoke_sessions.label': 'Revoke active sessions',
  'action.revoke_sessions.impact':
    'Terminates both active sessions for the account, including the legitimate one — the user will be signed out everywhere and the stolen cookie stops working. The scheduled service-account session belongs to a different principal and is left running.',
  'action.revoke_sessions.result':
    'SES-8842 terminated. The unregistered device lost access immediately; file activity stopped.',
  'action.reset_credentials.label': 'Reset credentials',
  'action.reset_credentials.impact':
    'Forces a password change and re-enrolment at next sign-in. It does not, on its own, invalidate a session cookie that was already issued.',
  'action.reset_credentials.result':
    'Password reset and MFA re-enrolment forced. Any credential captured on the cloned page is now worthless.',
  'action.isolate_endpoint.label': 'Isolate endpoint',
  'action.isolate_endpoint.impact':
    'Cuts WKS-114 off the network except for the response console. The user cannot work until it is released; the malicious extension can no longer reach its collector.',
  'action.isolate_endpoint.result':
    'WKS-114 isolated. The sideloaded extension is contained and preserved for analysis.',
  'action.block_indicator.label': 'Block indicators',
  'action.block_indicator.impact':
    'Adds the phishing domain and source address to the mail and egress blocklists. Non-destructive and reversible.',
  'action.block_indicator.result':
    'cy-case-secure-id.net and 203.0.113.47 blocked at the mail gateway and egress proxy.',
  'action.close_case.label': 'Close the case',
  'action.close_case.impact':
    'Ends the response and produces the debrief. Anything still unresolved stays unresolved.',
  'action.close_case.result': 'Case closed.',
  'action.confirm': 'Confirm',
  'action.cancel': 'Cancel',
  'action.confirm_title': 'Confirm: {label}',
  'action.predicted_impact': 'Predicted impact',
  'action.done': 'Applied',
  'action.locked': 'Not available yet',
  'action.destructive_badge': 'Consequential',

  /* ---------------- decisions ---------------- */
  'decision.title': 'Decision point',
  'decision.locked': 'Unlocks after the previous step',
  'decision.resolved': 'Decided',
  'decision.your_choice': 'Your choice',
  'decision.learning_goal': 'Learning goal',
  // Subordinate to the incident phase model, and worded so it reads as a tally
  // rather than as a rival answer to "how far through the case am I?".
  'decision.progress': '{index}/{total} answered',
  'decision.awaiting': 'No decision is open right now.',

  'decision.D1.prompt':
    'The alert names one account and the exfiltration attempt is already blocked. What do you do first?',
  'decision.D1.goal': 'Urgency does not remove the need to preserve evidence.',
  'decision.D1.opt.preserve': 'Preserve the reported message and inspect it',
  'decision.D1.opt.disable': 'Disable the account immediately, investigate later',
  'decision.D1.exp.preserve':
    'Correct. The blocked transfer bought you time. Preserving the message keeps the headers, the link and the delivery path — the only record of how the attacker got in.',
  'decision.D1.exp.disable':
    'Disabling first feels decisive, but it tips the attacker off and it does not stop a session that is already issued. Worse: the user can no longer help you reconstruct what they clicked. Evidence is now at risk.',

  'decision.D2.prompt':
    'The message claims to come from the IT service desk. How do you establish who actually sent it?',
  'decision.D2.goal': 'Display names are not identity evidence.',
  'decision.D2.opt.compare': 'Compare the authenticated sender and sign-in telemetry',
  'decision.D2.opt.trust': 'Trust the sender display name',
  'decision.D2.exp.compare':
    'Correct. The display name is free text an attacker chooses. The envelope sender, SPF, DKIM and DMARC results are the parts that were actually authenticated — and all three failed.',
  'decision.D2.exp.trust':
    'The display name said "CyCase IT Service Desk", but the envelope sender was cy-case-secure-id.net with SPF fail and no DKIM signature. Anyone can set a display name; only the authenticated fields carry weight.',

  'decision.D3.prompt':
    'The account is compromised. What is the containment plan for the identity?',
  'decision.D3.goal': 'A password reset alone may not invalidate an already stolen session.',
  'decision.D3.opt.revoke_then_reset': 'Revoke every active session, then reset credentials',
  'decision.D3.opt.password_only': 'Change the password only',
  'decision.D3.exp.revoke_then_reset':
    'Correct. Revocation kills the bearer token the attacker is holding right now; the credential reset then stops them signing in again. Order matters — revoke first, reset second.',
  'decision.D3.exp.password_only':
    'A password reset invalidates the credential, not the cookie. The stolen session was issued before the reset and stays valid until it is explicitly revoked. The attacker keeps working while you file the ticket.',

  'decision.D4.prompt':
    'The laptop that leaked the cookie is still online. How do you handle the endpoint?',
  'decision.D4.goal': 'Removing the visible symptom does not contain the incident.',
  'decision.D4.opt.collect_then_isolate': 'Collect the endpoint evidence, then isolate the host',
  'decision.D4.opt.delete_email': 'Delete the suspicious email and close the alert',
  'decision.D4.exp.collect_then_isolate':
    'Correct. The EDR report names the actual mechanism — a sideloaded extension with cookie read permission. Collect it first, isolate second, so the artifact survives containment.',
  'decision.D4.exp.delete_email':
    'The message is the symptom; the extension on the laptop is the cause. Deleting the mail destroyed the only copy of the headers and left the extension running, still able to hand over every new cookie.',

  'decision.D5.prompt': 'Is the reported account the only one affected?',
  'decision.D5.goal': 'Incident scope must be verified, not assumed.',
  'decision.D5.opt.sweep': 'Sweep every indicator across the estate',
  'decision.D5.opt.assume': 'Assume only the reported account is affected',
  'decision.D5.exp.sweep':
    'Correct. The sweep is the only thing that turns "one alert" into a measured blast radius — and it found the same phishing message and the same extension on a second machine.',
  'decision.D5.exp.assume':
    'The alert only sees what the alert saw. A second analyst received the same message and a second laptop carries the same extension. Assuming a single victim leaves an unowned foothold behind.',

  'decision.D6.prompt': 'You are ready to close. How do you close?',
  'decision.D6.goal': 'Closure requires evidence that the threat is contained.',
  'decision.D6.opt.verify': 'Review the containment checklist, then close',
  'decision.D6.opt.close_now': 'Close now without reviewing',
  'decision.D6.exp.verify':
    'Correct. The checklist is the handover. Closing against a verified list is what makes the next shift able to trust your work.',
  'decision.D6.exp.close_now':
    'Closing without the checklist means the next shift inherits your assumptions instead of your evidence. If anything is still open, nobody finds out until it is used again.',

  /* ---------------- artifacts ---------------- */
  'artifact.email.title': 'Phishing message — "Mandatory session re-verification"',
  'artifact.email.explanation':
    'The display name imitates the internal service desk, but the authenticated sender is an external lookalike domain and SPF, DKIM and DMARC all failed. The link points at a domain registered two days ago. This is the delivery step of the intrusion.',
  'artifact.url.title': 'Cloned sign-in portal',
  'artifact.url.explanation':
    'A pixel copy of the real SSO page on a two-day-old domain with a free certificate. It captured the username, the password, the MFA code and — critically — the session cookie, which is what made the rest of the attack possible.',
  'artifact.signin.title': 'Anomalous sign-in — d.arslan',
  'artifact.signin.explanation':
    'The sign-in succeeded from an unregistered device 1,842 km away, 21 minutes after a sign-in from Istanbul. MFA reports "satisfied" because the session claim was already present — no human approved anything.',
  'artifact.session.title': 'Active session SES-8842',
  'artifact.session.explanation':
    'A session issued at 03:02 with no password event behind it, still alive and still refreshing. It holds file read and list scopes. Until it is revoked, the attacker keeps the access.',
  'artifact.cookie.title': 'Token telemetry — cy_sso replay',
  'artifact.cookie.explanation':
    'The same cookie was issued to the registered laptop and later presented from an unregistered device. The cookie is bearer-only, so possession is authorization — and a password change does not invalidate it.',
  'artifact.fileops.title': 'Mass file enumeration on SRV-FILES-02',
  'artifact.fileops.explanation':
    '412 directory listings in under four minutes against a baseline of six per hour. This is an attacker mapping the drive before choosing what to take.',
  'artifact.dlp.title': 'Blocked exfiltration — Q3-customer-export.csv',
  'artifact.dlp.explanation':
    'An 18.4 MB customer export was pushed toward attacker infrastructure and blocked at 62%. Partial means some rows left. Treat this as a data exposure, not a clean save.',
  'artifact.edr.title': 'Endpoint report — WKS-114',
  'artifact.edr.explanation':
    'No malware, which is exactly why an antivirus scan would have cleared this host. The mechanism is a sideloaded browser extension with permission to read cookies on every site. It survives a browser restart and a password change.',

  /* ---------------- artifact field labels ---------------- */
  'field.display_name': 'Display name',
  'field.envelope_from': 'Authenticated sender',
  'field.reply_to': 'Reply-to',
  'field.to': 'Recipient',
  'field.subject': 'Subject',
  'field.spf': 'SPF',
  'field.dkim': 'DKIM',
  'field.dmarc': 'DMARC',
  'field.link': 'Embedded link',
  'field.body_excerpt': 'Body excerpt',
  'field.url': 'URL',
  'field.domain_registered': 'Domain registered',
  'field.tls_issued': 'Certificate issued',
  'field.hosting_asn': 'Hosting ASN',
  'field.page_signature': 'Page signature',
  'field.captured_fields': 'Captured fields',
  'field.visited_by': 'Visited by',
  'field.user': 'User',
  'field.result': 'Result',
  'field.source_ip': 'Source address',
  'field.geo': 'Location',
  'field.device_fingerprint': 'Device fingerprint',
  'field.mfa': 'MFA',
  'field.impossible_travel': 'Impossible travel',
  'field.session_id': 'Session ID',
  'field.state': 'State',
  'field.issued_at': 'Issued at',
  'field.last_seen': 'Last seen',
  'field.scopes': 'Scopes',
  'field.cookie_name': 'Cookie',
  'field.issued_to': 'Issued to',
  'field.presented_by': 'Presented by',
  'field.binding': 'Device binding',
  'field.password_change_effect': 'Effect of password change',
  'field.verdict': 'Verdict',
  'field.actor_session': 'Acting session',
  'field.list_calls': 'Directory listings',
  'field.baseline': 'User baseline',
  'field.downloads': 'Downloads',
  'field.top_path': 'Most accessed path',
  'field.file': 'File',
  'field.destination': 'Destination',
  'field.action': 'Control action',
  'field.classification': 'Classification',
  'field.host': 'Host',
  'field.malware_verdict': 'Malware verdict',
  'field.browser_extension': 'Browser extension',
  'field.extension_permissions': 'Extension permissions',
  'field.exfil_path': 'Exfiltration path',
  'field.host_state': 'Host state',
  'field.persistence': 'Persistence',

  /* ---------------- findings ---------------- */
  'finding.rogue_session_active.title': 'Stolen session still active',
  'finding.rogue_session_active.consequence':
    'SES-8842 was never revoked. The attacker keeps read access to the finance drive after the case is closed.',
  'finding.credentials_exposed.title': 'Credentials captured and still valid',
  'finding.credentials_exposed.consequence':
    'The password and MFA code entered on the cloned page still work. The attacker can sign in again at any time.',
  'finding.endpoint_uncontained.title': 'Endpoint still leaking cookies',
  'finding.endpoint_uncontained.consequence':
    'The sideloaded extension on WKS-114 is still running. Every new session the user creates is handed to the attacker.',
  'finding.indicators_unblocked.title': 'Attacker infrastructure still reachable',
  'finding.indicators_unblocked.consequence':
    'The phishing domain and collector address are not blocked. The same message can be delivered again tomorrow.',
  'finding.scope_unverified.title': 'Blast radius never measured',
  'finding.scope_unverified.consequence':
    'A second analyst received the same message and a second laptop carries the same extension. Nobody knows, because nobody looked.',
  'finding.resolved': 'Resolved',
  'finding.open': 'Open',
  'finding.resolved_by': 'Resolved by {action}',

  /* ---------------- incident facts and questions ---------------- */
  'incident.title': 'Session Ghost',
  'incident.fact.alert_source': 'The night-shift alert came from automated egress inspection, not from a user report.',
  'incident.fact.user': 'One finance account is named in the alert: d.arslan@cy-case.corp.',
  'incident.fact.exfil_blocked': 'An outbound customer export was blocked at 62% — a partial transfer completed.',
  'incident.fact.phish_sender': 'The message that started this failed SPF, DKIM and DMARC and came from an external lookalike domain.',
  'incident.fact.fake_portal': 'The link led to a pixel copy of the SSO page on a domain registered two days ago.',
  'incident.fact.impossible_travel': 'Two sign-ins, 1,842 km apart, 21 minutes apart, from two different devices.',
  'incident.fact.token_replay': 'The session cookie was issued to the registered laptop and later replayed from an unregistered device.',
  'incident.fact.rogue_session': 'Session SES-8842 is active on an unregistered device and was never authenticated by a password.',
  'incident.fact.malicious_extension': 'A sideloaded browser extension with cookie-read permission is the actual exfiltration path.',
  'incident.fact.second_host': 'The same phishing domain and the same extension also appear on a second analyst and a second laptop.',
  'incident.q.how_did_they_get_in': 'How did the attacker obtain access without a password event?',
  'incident.q.is_mfa_bypassed': 'Was multi-factor authentication bypassed, or never challenged?',
  'incident.q.still_active': 'Does the attacker still hold a valid session right now?',
  'incident.q.endpoint_clean': 'Is the user’s laptop actually clean?',
  'incident.q.who_else': 'Which other identities or hosts are affected?',
  'incident.q.contained': 'Is the intrusion contained?',

  /* ---------------- live layer ---------------- */
  'log.title': 'Case log',
  /* Who ran each row: the operator, the agent through a tool, or the sim. */
  'log.origin.human': 'You',
  'log.origin.agent': 'Agent',
  'log.origin.system': 'System',
  'topbar.feed': 'Feed',
  'topbar.feed.age': 'updated {age}',
  'topbar.paused': 'Paused',
  'topbar.pause': 'Pause simulation',
  'topbar.resume': 'Resume simulation',
  'topbar.rate': 'Events',
  'topbar.rate.value': '{total}/min',

  /* ---------------- the live edge of the event stream ---------------- */
  /*
   * Deliberately says what the stream *is* rather than shouting that it is
   * alive. "30s buckets" is the load-bearing half: it tells a reader why the
   * line does not move every second, which is the question a live-looking chart
   * otherwise leaves them holding.
   */
  'stream.live': 'Live · {seconds}s buckets',
  'stream.frozen': 'Paused · {seconds}s buckets',
  'stream.age': 'updated {age}',
  'stream.next': 'next in {seconds}s',
  'stream.frozen_at': 'frozen at {clock}',
  'stream.sample': 'Newest sample',
  /*
   * The announced sentences, and the reason the live one carries no numbers.
   *
   * A polite region is read out whenever its text changes. Put the current
   * reading in it and a screen reader recites a fresh set of digits every
   * bucket, forever — which is the "stream of numbers" an announcement is
   * supposed to replace. So the live sentence is constant: it is announced once,
   * when the stream starts, and then stays silent while the stream runs.
   *
   * The paused one may carry its reading, because a paused clock does not move:
   * it is announced exactly when the operator pauses, which is exactly when
   * "what did it stop at?" is the question. The current values remain readable
   * at any time from the chart's own description.
   */
  'stream.status.live': 'Event stream is live, taking one sample every {seconds} seconds.',
  'stream.status.frozen':
    'Event stream is paused and no longer updating. The last sample was taken at {clock}: {total} events per minute, {anomalous} anomalous.',

  /* ---------------- learning rail ----------------
   * None of this is VERA's. The rail carries the guidance the *engine* derives
   * from case state, the generated-guidance channel, and the tool log — so it
   * is named for what it holds rather than for the one person in the room. */
  'rail.title': 'Guidance and activity',
  'rail.collapse': 'Collapse guidance',
  'rail.expand': 'Expand guidance',
  'rail.extras': 'Guidance extras',
  'rail.tab.narration': 'Narration',
  'rail.tab.explore': 'Optional',
  'rail.tab.activity': 'Activity',
  'rail.tab.tools': 'Tools',
  'rail.explanation': 'Explanation',
  'rail.why': 'Why this matters',
  'rail.actions': 'Available actions',
  'rail.impact': 'Predicted impact',
  'rail.activity': 'Activity',
  'rail.activity.empty': 'Nothing has happened yet.',
  'rail.hint': 'Ask for a pointer',
  'rail.hint.topic': 'Topic',
  'rail.hint.no_penalty': 'Hints never affect your score.',
  'rail.hint.ask_about': 'Ask for a pointer about {topic}',
  'rail.actions.go': 'Go to {label}',
  'rail.hint.evidence': 'Evidence',
  'rail.hint.identity': 'Identity',
  'rail.hint.containment': 'Containment',
  'rail.hint.scope': 'Scope',
  'rail.origin.human': 'You',
  'rail.origin.agent': 'Agent',

  'assistant.state.idle': 'Standing by.',
  'assistant.state.analyzing': 'Working through the evidence.',
  'assistant.state.needs-input': 'Waiting on your decision.',
  'assistant.state.warning': 'Something here needs attention.',
  'assistant.state.success': 'That held.',
  'assistant.state.error': 'That call was rejected.',
  'assistant.welcome':
    'The alert names one account and one blocked transfer. Start with the message that reached the user — everything else follows from it.',

  /* ---------------- hints ---------------- */
  'hint.when.email_not_inspected': 'The reported message has not been opened yet.',
  'hint.when.email_deleted': 'The message was deleted.',
  'hint.when.no_auth_timeline': 'Sign-in telemetry has not been rebuilt.',
  'hint.when.edr_not_inspected': 'The endpoint report has not been read.',
  'hint.when.evidence_complete': 'Evidence collection looks complete.',
  'hint.when.cookie_not_inspected': 'Token telemetry has not been read.',
  'hint.when.identity_complete': 'Identity analysis looks complete.',
  'hint.when.no_session_inventory': 'Active sessions have not been listed.',
  'hint.when.sessions_not_revoked': 'Sessions are still active.',
  'hint.when.credentials_not_reset': 'Credentials have not been reset.',
  'hint.when.endpoint_not_isolated': 'The endpoint is still on the network.',
  'hint.when.containment_complete': 'Containment looks complete.',
  'hint.when.no_indicator_scope': 'Indicators have not been swept.',
  'hint.when.indicators_not_blocked': 'Indicators are not blocked.',
  'hint.when.scope_assumed': 'Scope was assumed rather than measured.',
  'hint.when.scope_complete': 'Scope looks measured.',

  'hint.evidence.inspect_email':
    'Open the reported message first. The header block tells you who actually sent it, and the link tells you where the user went.',
  'hint.evidence.email_deleted':
    'The message is gone, so reconstruct from what survived: the proxy record of the cloned page and the endpoint report both still exist.',
  'hint.evidence.run_auth_timeline':
    'Rebuild the authentication timeline. You cannot tell a stolen session from a stolen password until you see whether a password event ever happened.',
  'hint.evidence.inspect_edr':
    'Read the endpoint report before isolating the host. It names the mechanism, and isolation is easier to justify once you can point at it.',
  'hint.evidence.complete':
    'You have the delivery, the replay and the mechanism. That is enough to defend every containment decision you are about to make.',
  'hint.identity.display_name':
    'Treat the display name as decoration. Only the envelope sender and the SPF/DKIM/DMARC results were authenticated by anything.',
  'hint.identity.compare_telemetry':
    'Compare the two sign-ins side by side: same account, different device fingerprint, different country, and only one of them involved a password.',
  'hint.identity.cookie_replay':
    'Look at the token telemetry. A cookie issued to one device and presented from another is replay, and replay explains the missing MFA prompt.',
  'hint.identity.complete':
    'Identity is settled: the account was not guessed, its session was taken. That is why the response has to target sessions, not just passwords.',
  'hint.containment.inventory_first':
    'List the active sessions before you revoke. Revoking blind works, but you will not be able to prove which session was the attacker’s.',
  'hint.containment.revoke':
    'Revoke the active sessions. The stolen cookie is a bearer token — it stays valid until something explicitly kills it.',
  'hint.containment.reset':
    'Reset the credentials too. The password and MFA code were typed into the attacker’s page, so they are compromised independently of the session.',
  'hint.containment.isolate':
    'Isolate the laptop. The extension that stole the cookie is still installed, so a fresh sign-in would simply hand over a fresh cookie.',
  'hint.containment.complete':
    'Sessions, credentials and endpoint are all handled. The identity side of this incident is contained.',
  'hint.scope.run_sweep':
    'Run the indicator sweep. One alert tells you where the detection fired, not where the attacker went.',
  'hint.scope.block':
    'Block the indicators. It is cheap, reversible, and it stops the same message arriving again tomorrow.',
  'hint.scope.assumed':
    'You assumed a single victim. The sweep is still available and it is the only way to turn that assumption into a measurement.',
  'hint.scope.complete':
    'Scope is measured and the infrastructure is blocked. You can defend the blast radius you are about to report.',

  /* ---------------- score reasons ---------------- */
  'score.baseline_efficiency': 'Clean start',
  'score.auth_timeline': 'Rebuilt the authentication timeline',
  'score.session_inventory': 'Listed active sessions before acting',
  'score.indicator_scope': 'Measured the blast radius',
  'score.revoke_sessions': 'Revoked the stolen session',
  'score.blind_revoke': 'Revoked without listing sessions first',
  'score.reset_credentials': 'Reset the exposed credentials',
  'score.isolate_endpoint': 'Isolated the leaking endpoint',
  'score.isolated_without_evidence': 'Isolated before collecting endpoint evidence',
  'score.block_indicator': 'Blocked attacker infrastructure',
  'score.inspect_email': 'Inspected the phishing message',
  'score.inspect_cookie': 'Inspected the token telemetry',
  'score.inspect_edr': 'Inspected the endpoint report',
  'score.D1_preserve': 'Preserved evidence under time pressure',
  'score.D1_disable': 'Acted before preserving evidence',
  'score.D2_compare': 'Verified the authenticated sender',
  'score.D2_trust': 'Trusted a display name as identity',
  'score.D3_revoke_then_reset': 'Planned revocation before reset',
  'score.D3_password_only': 'Planned a password reset alone',
  'score.D4_collect': 'Collected endpoint evidence before containment',
  'score.D4_delete_email': 'Destroyed evidence to clear the alert',
  'score.D5_sweep': 'Chose to verify scope',
  'score.D5_assume': 'Assumed the scope',
  'score.D6_close_now': 'Closed without reviewing the checklist',
  'score.rejected_call': 'Rejected call',
  'score.closed_with_open_findings': 'Closed with unresolved critical findings',

  /* ---------------- debrief ---------------- */
  'debrief.title': 'Debrief',
  'debrief.outcome': 'Outcome',
  'debrief.ending.contained': 'Contained',
  'debrief.ending.partial': 'Partial containment',
  'debrief.ending.contained.body':
    'You preserved the evidence, proved the session was stolen rather than guessed, cut the attacker off at the session and the endpoint, and measured how far it reached before you closed.',
  'debrief.ending.partial.body':
    'The case was closed with critical findings still open. Below is exactly what was missed and what it costs.',
  'debrief.score': 'Score',
  'debrief.breakdown': 'Breakdown',
  'debrief.bucket.evidence': 'Evidence quality',
  'debrief.bucket.containment': 'Containment quality',
  'debrief.bucket.scope': 'Scope accuracy',
  'debrief.bucket.efficiency': 'Decision efficiency',
  'debrief.decisions': 'Your decisions',
  'debrief.missed': 'What was missed',
  'debrief.nothing_missed': 'Nothing critical was left open.',
  'debrief.entries': 'Score log',
  'debrief.replay': 'Run the case again',
  'debrief.collaboration': 'Human and agent activity',
  'debrief.calls_human': '{count} by you',
  'debrief.calls_agent': '{count} by the agent',

  /* ---------------- errors ---------------- */
  'error.INVALID_INPUT': 'Invalid input',
  'error.STALE_STATE': 'State moved on',
  'error.ACTION_NOT_ALLOWED': 'Not allowed yet',
  'error.NOT_FOUND': 'Not found',
  'error.generic': 'That call was rejected and nothing changed.',
  'error.stale.message': 'The state changed since this call was prepared.',
  'error.stale.recovery': 'Call get_incident to read the current stateVersion, then retry.',
  'error.not_found.artifact': 'No artifact with that id exists in this case.',
  'error.not_found.artifact.recovery': 'Use get_incident to list availableArtifacts.',
  'error.locked.artifact': 'That artifact has not been surfaced yet.',
  'error.locked.artifact.recovery': 'Run the {diagnostic} diagnostic first.',
  'error.destroyed.artifact': 'That artifact was destroyed earlier in this case.',
  'error.destroyed.artifact.recovery': 'It cannot be recovered. Work from the artifacts that remain.',
  'error.action_not_allowed': 'That action is not available in the current state.',
  'error.close_needs_decision': 'The case cannot be closed before the closing decision is submitted.',
  'error.close_needs_decision.recovery': 'Submit decision D6 with submit_decision, then retry.',
  'error.already_closed': 'The case is already closed.',
  'error.already_closed.recovery': 'Read the debrief, or restart the case.',
  'error.already_performed': 'That action has already been applied.',
  'error.already_performed.recovery': 'Check unresolvedCriticalFindings for what is still open.',
  'error.decision_locked': 'That decision is not open yet.',
  'error.decision_locked.recovery': 'Resolve the earlier decisions first; get_incident names the open one.',
  'error.decision_already': 'That decision has already been made.',
  'error.decision_already.recovery': 'Decisions are final within a run. Continue with the next one.',
  'error.option_mismatch': 'That option does not belong to that decision.',
  'error.option_mismatch.recovery': 'Use the optionIds listed in get_incident.openDecision.',
  'error.diagnostic_done': 'That diagnostic has already been run.',
  'error.diagnostic_done.recovery': 'Its result is already in the case state.',

  /* ---- present_guidance rejections (narration is refused, never stripped) ---- */
  'error.guidance.empty': 'A guidance line must contain text.',
  'error.guidance.empty.recovery':
    'Send one plain-text sentence in message, or do not call present_guidance at all.',
  'error.guidance.too_long': 'A guidance line may be at most 500 characters.',
  'error.guidance.too_long.recovery':
    'Rewrite it shorter and resend. The line is refused rather than truncated, because a cut sentence can invert the meaning of a warning.',
  'error.guidance.markup': 'A guidance line may not contain markup characters.',
  'error.guidance.markup.recovery':
    'Resend the same point as plain prose with no angle brackets. Markup is refused rather than stripped, so nothing the player needs disappears silently.',
  'error.guidance.link': 'A guidance line may not contain a link.',
  'error.guidance.link.recovery':
    'Name the artifact id (for example art_email_001) instead of linking. Link text can disguise its destination, which is the exact pattern this case teaches.',
  'error.guidance.url': 'A guidance line may not contain a web address.',
  'error.guidance.url.recovery':
    'Refer to evidence by artifact id. Indicators already defanged in the case data (hxxps://…[.]net) are allowed and will be shown to the player verbatim.',

  /* ---------------- webmcp panel ---------------- */
  'webmcp.title': 'Agent interface',
  'webmcp.status.unsupported': 'WebMCP is not available in this browser.',
  'webmcp.status.unsupported_detail':
    'The case is fully playable without it. In a supported browser the same actions are also exposed as agent tools.',
  'webmcp.status.registered': '{count} tools registered on this page',
  'webmcp.status.partial': 'Only {count} of {total} tools registered',
  'webmcp.status.partial_detail':
    'The browser exposes WebMCP but rejected at least one tool. The dashboard is unaffected; the agent will see a smaller tool set.',
  'webmcp.status.unverified':
    'Registration succeeded here, but this build has not yet been confirmed against a browser with WebMCP enabled.',
  'webmcp.tools': 'Registered tools',
  'webmcp.log': 'Tool call log',
  'webmcp.log.empty': 'No tool calls yet.',
  'webmcp.effect': 'Visible effect',
  'webmcp.copy_prompt': 'Copy an example agent prompt',
  'webmcp.copied': 'Copied',
  /* ---------------- fallback / responsive ---------------- */
  'fallback.title': '2D mode',
  'fallback.body':
    'The 3D office is disabled on this screen size. The full case is playable here.',
  'fallback.toggle_3d': '3D office',
  'fallback.monitor.left': 'Telemetry',
  'fallback.monitor.center': 'Incident',
  'fallback.monitor.right': 'Topology',
  'fallback.prev': 'Previous monitor',
  'fallback.next': 'Next monitor',

  /*
   * Why the flat monitor wall is on screen instead of the room.
   *
   * The 2D path used to arrive with no explanation, which reads as the 3D
   * office having failed to load rather than as a deliberate, complete way to
   * play the case. Each reason is a full sentence because it is announced to a
   * screen reader as well as shown.
   */
  'fallback.reason.preference': '2D mode is on because you turned the 3D office off. The full case is playable here.',
  'fallback.reason.viewport':
    '2D mode is on because this window is too narrow for the 3D office. The full case is playable here.',
  'fallback.reason.webgl':
    '2D mode is on because this browser cannot draw WebGL. The full case is playable here.',
  'fallback.reason.load_failed':
    '2D mode is on because the 3D office could not be loaded. The full case is playable here, and nothing about the case has been lost.',
  'fallback.reason.context_lost':
    '2D mode is on because the graphics context was lost. The full case is playable here, and nothing about the case has been lost.',
  'fallback.reason.label': 'Why you are in 2D mode',
  'fallback.retry_3d': 'Try the 3D office again',

  /* ---------------- a11y ---------------- */
  'a11y.live_region': 'Case updates',
  'a11y.monitor_left': 'Left monitor: event telemetry',
  'a11y.monitor_center': 'Center monitor: incident brief',
  'a11y.monitor_right': 'Right monitor: identity and device topology',
  'a11y.severity_icon': 'Critical severity',
  'a11y.untrusted_icon': 'Untrusted content',
  'a11y.resolved_icon': 'Resolved',
  'a11y.open_icon': 'Open',

  /* ---------------- office head-look (P0.1) ---------------- */
  'office.headlook.label': 'Office room — look around from your chair',
  'office.headlook.help':
    'Drag the room, or use the arrow keys or A, D, W and S, to turn your head. The view is limited to what you can see without leaving the chair. Press Home, or the Recenter view control, to face the monitors again. Mouse look captures the pointer; Escape releases it.',
  'office.headlook.mouse_look': 'Mouse look',

  /*
   * The first-run head-look hint and the mouse-look status line.
   *
   * Added rather than rewritten: nothing above changes wording. The room is the
   * one surface in the product with an interaction and no affordance, so the
   * three gestures are named once, compactly, and the panel stands down as soon
   * as one of them has been used.
   */
  'office.headlook.help_title': 'Look around the room',
  'office.headlook.help_drag_key': 'Drag',
  'office.headlook.help_drag': 'anywhere in the room',
  'office.headlook.help_keys_key': 'Arrows / WASD',
  'office.headlook.help_keys': 'turn your head',
  'office.headlook.help_home_key': 'Home',
  'office.headlook.help_home': 'faces the monitors again',
  'office.headlook.help_show': 'Look controls',
  'office.headlook.help_dismiss': 'Got it',
  'office.headlook.release': 'Mouse look is on — press Esc to release the pointer',
  'office.headlook.lock_denied':
    'The browser would not capture the pointer. Drag the room, or use the arrow keys, to look around instead.',
  'office.headlook.lock_unsupported':
    'This browser has no pointer capture. Drag the room, or use the arrow keys, to look around instead.',
  /* ---------------- guided path (audit contract P0.6) ---------------- */
  'guide.title': 'Next required step',
  'guide.why': 'Why this step',
  'guide.includes': 'This operation runs',
  'guide.decision_hint': 'Pick one. Both answers continue the case; only one contains it properly.',
  'guide.consequential': 'Consequential — read the impact before you run it',
  'guide.impact': 'Impact',
  'guide.done_title': 'What just happened',
  'guide.result': 'Result',
  'guide.changed': 'What changed',
  'guide.mattered': 'Why it mattered',
  'guide.points': 'Score {points}',
  'guide.state_version': 'Case state is now v{version}',
  'guide.finding_resolved': 'Closed: {finding}',
  'guide.evidence_unlocked': 'New evidence available: {artifact}',
  'guide.evidence_why': 'Evidence read before a call is evidence you can still defend afterwards.',
  'guide.closed': 'The case is closed.',
  'guide.closed.body': 'Nothing further is required. The debrief has the score and the reasoning.',
  'guide.running': 'Running…',

  'guide.d1.title': 'Decide how to handle the reported message',
  'guide.d1.why': 'The first move decides whether the evidence survives the response.',
  'guide.d2.title': 'Decide how to test the sender',
  'guide.d2.why': 'A display name is not an identity. Decide what you will actually trust.',
  'guide.d3.title': 'Decide how to cut the attacker off',
  'guide.d3.why': 'A stolen session outlives a password. Decide the order before you act.',
  'guide.d4.title': 'Decide what happens to the endpoint',
  'guide.d4.why': 'Isolation destroys volatile evidence. Decide what you collect first.',
  'guide.d5.title': 'Decide how far to look',
  'guide.d5.why': 'One named identity is where an incident starts, not where it ends.',
  'guide.d6.title': 'Decide how to close',
  'guide.d6.why': 'Closing is a claim that nothing critical is open. Decide how you verify it.',

  'guide.read_report.title': 'Read the reported message',
  'guide.read_report.why':
    'D2 stays locked until the reported message is on the table, and the header is what disproves the sender.',
  'guide.read_report.cta': 'Open the reported message',

  'guide.rebuild_timeline.title': 'Rebuild the authentication timeline',
  'guide.rebuild_timeline.why':
    'The timeline is what turns a suspicion into a token replay you can name, and it unlocks the token telemetry behind it.',
  'guide.rebuild_timeline.cta': 'Rebuild the timeline and read the token telemetry',

  'guide.contain.title': 'Contain the identity and the endpoint',
  'guide.contain.why':
    'One operation, in the order that keeps the score: inventory the sessions before killing them, and pull the endpoint report before the host goes dark.',
  'guide.contain.cta': 'Run the containment operation',

  'guide.sweep.title': 'Sweep the estate for the same indicators',
  'guide.sweep.why':
    'Scope first, then block. The sweep is what proves no second identity is carrying the same cookie.',
  'guide.sweep.cta': 'Sweep and block the indicators',

  'guide.close.title': 'Close the case',
  'guide.close.why': 'Every critical finding is resolved. Closing records the outcome and freezes the score.',
  'guide.close.cta': 'Close the case now',

  'guide.unblock.title': 'Collect what {decision} is waiting for',
  'guide.unblock.why': 'The next decision stays locked until this evidence is on the table.',
  'guide.unblock.cta': 'Collect the missing evidence',

  /* ---------------- incident phases: the one progress model ---------------- */
  'phase.triage': 'Triage',
  'phase.investigate': 'Investigate',
  'phase.contain': 'Contain',
  'phase.scope': 'Scope',
  'phase.close': 'Close',
  'phase.rail': 'Incident phase',
  'phase.progress': '{phase} — step {index} of {total}',
  'phase.complete': 'Every phase is complete.',
  'phase.state.done': 'done',
  'phase.state.active': 'in progress',
  'phase.state.upcoming': 'not started',
  'phase.count': '{done}/{total}',

  /* ---------------- one stage at a time ---------------- */
  'guide.stage.open': 'Open {label}',
  'guide.stage.run': 'Run {label}',
  'guide.stage.then': 'Then, separately',
  'guide.stage.one_at_a_time':
    'One step at a time. Each of these is a separate action you authorise on its own.',

  /* ---------------- receipts ---------------- */
  'receipt.title': 'What this did',
  'receipt.result': 'Result',
  'receipt.changed': 'What changed',
  'receipt.unchanged': 'What did not change',
  'receipt.why': 'Why it matters',
  'receipt.state.done': 'Applied',
  'receipt.state.partial': 'Partly applied',
  'receipt.state.failed': 'Refused',
  'receipt.failed.title': 'That did not run',
  'receipt.failed.why':
    'A refused call changes nothing at all — no score, no findings, no case state.',
  'receipt.unchanged.state': 'Case state is still v{version}',
  'receipt.still_open': 'Still open: {finding}',
  'receipt.evidence_recorded': 'Recorded as read: {artifact}',
  'receipt.evidence_destroyed': 'Destroyed permanently: {artifact}',
  'receipt.recovery.corrective': 'Fix it now: {label}',
  'receipt.recovery.next': 'Continue: {label}',
  'receipt.recovery.decide': 'Continue: answer the open decision',

  /* ---------------- what the agent is asking for ---------------- */
  'proposal.title': 'The agent suggests',
  'proposal.badge': 'Awaiting your approval',
  'proposal.move': 'It is proposing: {label}.',
  'proposal.approve': 'Approve and run it',
  'proposal.decline': 'Decline',
  'proposal.hint':
    'The suggestion changed nothing. Approving runs it as you, and it is recorded as your decision.',

  /* ---------------- the corrective path ---------------- */
  'corrective.title': 'Corrective step',
  'corrective.intro':
    'This was not the route you chose, and choosing it does not undo what that cost. It is what still closes the incident.',
  'corrective.why': 'Your decision did not authorise this, and {finding} is still open.',
  'corrective.count': '{count} still fixable',
  'corrective.cta': 'Apply {label}',
  'corrective.also': 'Still fixable after that: {labels}',

  'guide.optional': 'Optional evidence',
  'guide.explore': 'Explore more',
  'guide.explore.hint':
    'Optional evidence and diagnostics. None of it is required to contain this incident.',
  'guide.explore.empty': 'Nothing optional is available right now.',
  'guide.explore.count': '{count} optional',
  'guide.explore.open': 'Open {label}',

  /* ---------------- the two clocks (audit contract P0.6) ---------------- */
  'clock.play': 'Play time',
  'clock.incident': 'Incident time',
  'clock.multiplier': '{multiplier}×',
  'clock.explainer':
    'Incident time runs at {multiplier}× play time while the case is live. Each operation you run adds its own incident cost on top; {cost} of the incident clock so far came from operations, not from time at the desk.',
  /* ---------------- live narration (present_guidance) ---------------- */
  'guidance.log.title': 'Narration log',
  'guidance.log.empty': 'Nothing has been narrated yet.',
  'guidance.untrusted_notice':
    'Narration is generated text. It is stored and shown as plain text and can never change the case state, the score or what is allowed.',
  /* ---------------- audio and narration ---------------- */
  'settings.narration': 'Narration',
  'settings.narration_on': 'Narration on',
  'settings.narration_off': 'Narration off',
  'settings.shell': 'Settings',
  /* The disclosure that holds the operating system's voice list. */
  'settings.advanced': 'Advanced',
  'settings.voice': 'Voice',
  'settings.voice_auto': 'Automatic',
  'settings.voice_remote': 'online',
  /*
   * Two groups, because a browser's forty-voice list is mostly voices for
   * languages this product has no copy in. The recommended group uses the same
   * rule the automatic pick uses, so the voice at the top is the one a player
   * would have got by doing nothing.
   */
  'settings.voice_group.recommended': 'For this language',
  'settings.voice_group.other': 'Other languages',
  'settings.voice_search': 'Find a voice',
  'settings.voice_search_placeholder': 'Name or language tag',
  'settings.voice_show_all': 'Show all voices ({count} more)',
  'settings.voice_show_recommended': 'Show only voices for this language',
  'settings.voice_hint':
    'Spoken by your browser, so the voice and its quality come from your browser and operating system, not from CYCASE. Every line is also written out in full below.',
  'settings.voice_none':
    'This browser offers no speech voices. Every line is written out in full below, so nothing is lost.',
  'audio.alarm_caption': 'The centre monitor is sounding an alarm.',
  'audio.alarm_caption_silent':
    'The centre monitor is flashing an alarm. The alarm sound is not installed in this build.',
  'audio.repeat_line': 'Repeat that line',

  /* ---------------- console-wide controls ---------------- */
  'console.range': 'Time range',
  'console.range.applies': 'Applies to every tool',
  'console.range.inventory': 'Live state — the {range} range does not filter this table.',
  'console.range.hidden': '{count} more outside the {range} range.',
  'console.range.hidden_one': '1 more outside the {range} range.',
  'console.range.widen': 'Widen to all time',
  'console.ingest':
    'Live ingest is running. {events} events are indexed for the {range} range. The newest is {at}.',
  'console.ingest.quiet':
    'Live ingest is running. Nothing has been indexed for the {range} range yet.',
  'console.ingest.age': ' Newest event {age}.',
  'console.ingest.agent': ' The agent last called a tool {age}.',
  'console.focus.following': 'Following {label}.',
  'console.focus.matches': ' {tools} have rows for it.',
  'console.focus.none_elsewhere': ' No other tool has a row for it.',
  'console.focus.clear': 'Stop following {label}',
  'console.focus.pivot': '{tool} · {count}',
  'console.focus.follow': 'Follow {value} across the tools',
  'console.focus.follow_short': 'Follow',
  'console.focus.following_short': 'Following',
  'console.focus.match': 'Followed',
  'console.focus.idle': 'Nothing is being followed. Choose a value in any tool to carry it across.',
  'console.focus.kind.identity': 'identity',
  'console.focus.kind.host': 'host',
  'console.focus.kind.indicator': 'indicator',

  /* ---------------- SIEM query feedback ---------------- */
  'investigate.siem.notes': 'About this query',
  'investigate.siem.notes_count': '{count} note about the query',
  'investigate.siem.notes_count_plural': '{count} notes about the query',

  /* ---------------- source health ---------------- */
  'command.sources': 'Source health',
  'command.sources.intro':
    'Every source Case 001 can feed, and what it has produced. A quiet source is not a broken one — it means nothing from it has reached the index yet.',
  'command.sources.col.source': 'Source',
  'command.sources.col.systems': 'Systems',
  'command.sources.col.events': 'Events',
  'command.sources.col.last': 'Newest event',
  'command.sources.feeding': 'Feeding',
  'command.sources.quiet': 'Quiet',
  'command.sources.none': 'nothing indexed',
  'command.containment': 'Containment',
  'command.containment.open': '{count} of {total} critical findings still open',
  'command.containment.closed': 'All {total} critical findings resolved',

  /* ---------------- chain of custody ---------------- */
  'evidence.custody': 'Provenance and chain of custody',
  'evidence.custody.intro':
    'When the source recorded it, and everything this investigation has done to it since.',
  'evidence.custody.source': 'Recorded by {source}',
  'evidence.custody.emitted': 'Recorded at source',
  'evidence.custody.collected': 'Collected into the case',
  'evidence.custody.destroyed': 'Destroyed by a response decision',
  'evidence.custody.by.human': 'you, at the console',
  'evidence.custody.by.agent': 'the agent, over WebMCP',
  'evidence.custody.by.system': 'the source system',
  'evidence.custody.by': 'by {by}',
  'evidence.custody.uncollected':
    'This record exists at its source and has not been collected into the case yet.',
  'evidence.custody.col.at': 'Clock',
  'evidence.custody.col.step': 'Step',
  'evidence.custody.col.by': 'Attributed to',
  'evidence.custody.gap':
    'Recorded at {emitted} and collected at {collected} — the case did not know this until the later time.',

  /* ---------------- consequence preview and verification ---------------- */
  'respond.preview': 'What this will change',
  'respond.preview.none':
    'Nothing in the simulated sources would move. An operation with no observable effect is a defect, not a safe choice.',
  'respond.source.identity': 'Identity provider',
  'respond.source.endpoint': 'Endpoint / EDR',
  'respond.source.network': 'Network controls',
  'respond.source.scope': 'Scope',
  'respond.source.incident': 'Incident record',
  'respond.preview.col.fact': 'Fact',
  'respond.preview.col.before': 'Now',
  'respond.preview.col.after': 'After',
  'respond.preview.count': '{count} source facts would move',
  'respond.preview.count_one': '1 source fact would move',
  'respond.preview.honest':
    'Derived by running this operation against a copy of the case and comparing the sources. It cannot promise a change the simulation will not make.',
  'respond.verification.verified': 'Verified in the sources',
  'respond.verification.partial': 'Applied, but {count} facts no longer read as it left them',
  'respond.verification.pending': 'Not applied yet',
  'respond.verification.check': 'Check {tool}',

  /* ---------------- attributed chronology ---------------- */
  'timeline.attribution': 'Attribution',
  'timeline.origin.all': 'Everything',
  'timeline.origin.system': 'The estate',
  'timeline.origin.human': 'You',
  'timeline.origin.agent': 'The agent',
  'timeline.origin.count': '{label} · {count}',
  'timeline.by.system': 'Estate',
  'timeline.by.human': 'You',
  'timeline.by.agent': 'Agent',
  'timeline.empty_filter': 'Nothing in the chronology is attributed to that yet.',
  'timeline.chronology': 'Case chronology',
  'timeline.chronology.intro':
    'What happened to the estate and what this console did about it, on one clock.',

  /* ---------------- debrief depth ---------------- */
  'debrief.unread': 'Evidence never read',
  'debrief.unread.none': 'Every reachable record was collected.',
  'debrief.unread.hint': 'Each of these was reachable and would have changed what you knew.',
  'debrief.unrun': 'Queries never run',
  'debrief.unrun.none': 'Every diagnostic query was run.',
  'debrief.goals': 'Learning goals',

  /* ---------------- office monitors as tools (redesign §5) ----------------
   *
   * Appended rather than folded into the `a11y.monitor_*` block above, which
   * still names the old contents ("identity and device topology") and belongs
   * to whatever else reads it. Each name here says what the screen is; the open
   * label names the tool and the destination, because a control that moves the
   * player to another scene has to say so before they press it. It is the
   * button's visible text and its accessible name at once — an `aria-label`
   * saying something longer would be a WCAG 2.5.3 mismatch, not an improvement.
   */
  'monitor.left.name': 'Left monitor: SIEM live event stream',
  'monitor.center.name': 'Center monitor: incident command',
  'monitor.right.name.identity': 'Right monitor: Identity',
  'monitor.right.name.endpoint': 'Right monitor: Endpoint and EDR',
  'monitor.tool.siem': 'the SIEM tool',
  'monitor.tool.command': 'Command',
  'monitor.tool.identity': 'the Identity tool',
  'monitor.tool.endpoint': 'the Endpoint tool',
  'monitor.open': 'Open {tool} in the console',
  /* ---------------- per-decision pointers (the three rungs) ----------------
   *
   * `DECISION_HINTS` in the Case 001 fixture names every key below, so a
   * missing one renders as an empty pointer rather than as a failure. The
   * ladder's rules are written out beside that array and each line here was
   * held to them: level 1 names a surface and a record and stops, level 2 is
   * an idea that survives being carried to a different incident, level 3 walks
   * the inference and stops one step short of the option.
   *
   * The register is deliberately not VERA's and not the generated channel's.
   * A pointer is the console reading its own case state back to you, which is
   * why every line is in the second person about the dashboard. Nothing here
   * may be spoken, attributed or narrated.
   */
  'hint.D1.l1':
    'Two things are one click away: the reported message in the evidence list, and the account controls in the response console. Only one of the two changes the estate.',
  'hint.D1.l2':
    'Evidence is perishable and containment is never free. An action that changes the estate can also change what the estate is still able to tell you, so the order you do them in is itself a decision.',
  'hint.D1.l3':
    'The export was stopped before it finished, so nothing further is leaving in the next minute — the pressure you feel is not coming from the clock. What is still in front of you is the route the intrusion took: headers, the link, the delivery path, all of it held in records that an action against the account can disturb. So "act now, read later" is not a free choice here, it is a trade of one thing for the other. What is left is deciding which of the two is still there in five minutes if you leave it alone.',

  'hint.D2.l1':
    'Open the message record and read the header block rather than the body. The sender is listed there as more than one field, and the authentication timeline in diagnostics covers the same minutes.',
  'hint.D2.l2':
    'Every mail carries two kinds of sender: the part a human types and the part a server proves. Only one of them was tested by anything before it reached you, and telling them apart transfers to every message you will ever triage.',
  'hint.D2.l3':
    'The message presents itself as internal and the body reads exactly like the service desk. But the fields a receiving server actually checked — the authenticated sender, and the three results recorded next to it — disagree with the fields a person typed in. One of those two sets was chosen freely by whoever sent the mail; the other was tested against a published record and failed. That leaves the friendly reading of this header with nothing behind it. What is left is deciding which of the two sets you are willing to treat as evidence.',

  'hint.D3.l1':
    'The session inventory in diagnostics and the token telemetry record both describe the account you are about to write a containment plan for.',
  'hint.D3.l2':
    'A credential proves who you are once. The token issued afterwards carries that proof around for as long as it lives, and it is presented on its own without the credential being asked for again. Two different things, cancelled by two different acts.',
  'hint.D3.l3':
    'The session in question was issued at 03:02 with no password event behind it, and the same cookie has since been presented from a device this account has never used. It is bearer-only: whoever holds it is treated as the user, and nothing re-checks the credential while it is alive. So replacing the secret changes what a future sign-in has to supply and leaves everything already issued exactly where it stands. That rules out treating the credential as the whole of containment. What is left is naming what else has to be cancelled, and which of the two you do first.',

  'hint.D4.l1':
    'The endpoint report for WKS-114 is in the evidence list. The controls that act on a host live in the response console, and the report is what says what such a control would be acting on.',
  'hint.D4.l2':
    'A symptom is the part of an intrusion you were shown. A mechanism is the part that keeps working after the symptom is gone. Removing the first is visible and satisfying and changes nothing, which is why the question is always which of the two you are looking at.',
  'hint.D4.l3':
    'The message reached the user once and has already done its work. The endpoint report finds no malware and names something else instead: an extension in the browser holding permission to read cookies on every site, surviving a restart and unaffected by anything you do to the account. So the thing still producing access lives on the host, not in the mailbox — and taking that host off the network also changes what it can still tell you. Tidying the visible item and calling the incident handled is therefore not on the table. What is left is ordering the two: what you need off that host, and the moment you cut it off.',

  'hint.D5.l1':
    'Diagnostics holds a query that takes indicators as its input, and the indicators are already in the case: the sender domain, the address the session came from, the name of the extension.',
  'hint.D5.l2':
    'An alert reports what one detection happened to see, not how far the thing reached. Those are two different numbers, and the second one is only ever produced by going and looking for the same markers everywhere else.',
  'hint.D5.l3':
    'Every marker in this case is reusable: a domain delivers to more than one mailbox, an extension installs on more than one machine, an address talks to more than one system. An alert, though, only ever reports the account its detection fired on, and says nothing about the others in either direction. So from where you are sitting a genuinely clean estate and an unexamined one look identical. The alert cannot be read as a measurement of reach. What is left is choosing whether you produce that measurement before you act on it.',

  'hint.D6.l1':
    'The containment checklist is on the incident summary, beside the response list. It reads the state of each source system back to you, rather than the list of operations you submitted.',
  'hint.D6.l2':
    'An operation that was submitted and an outcome that was verified are two different facts, and only the second is safe to hand to somebody else. Closing a case is a handover, so it is the second one that closure should rest on.',
  'hint.D6.l3':
    'An operation reports success at the moment you run it, and that moment is all the response list records. The sources themselves are what say whether a session is still alive, whether an indicator is still reachable, whether a host is still on the network — and all three are readable right now, at no cost and with no effect on the estate. Closing writes the case shut against whichever of the two you looked at last. So "I ran the steps" is not an answer to "is it contained". What is left is deciding whether you look before you write it shut.',

  /* ---------------- supporting sources (shown only after the answer) -------
   *
   * One sentence each, and each one says what the record shows rather than what
   * the player did. `art_url_001` is revealed by D1's correct branch only, so a
   * player who disabled the account first never opened it; a line that said "as
   * you saw" would be false for exactly the player who most needs to read it.
   */
  'support.D1.email':
    'The message record is the only place the headers, the delivery path and the live link survive together — the whole account of how the intrusion arrived, held in one record and nowhere else.',
  'support.D1.url':
    'The cloned portal took the session cookie alongside the password and the code, which is why the intrusion never needed the credential a second time.',
  'support.D2.email':
    'The display name and the authenticated sender in this record disagree, and SPF, DKIM and DMARC all failed: every field that any server actually tested says the mail came from outside.',
  'support.D2.auth_timeline':
    'The timeline puts a credential entry on an off-domain page at 02:44 and a cookie presented from a new device at 03:02 with no password event in between — sender identity and sign-in behaviour telling one story.',
  'support.D3.cookie':
    'The same cy_sso cookie was issued to the registered laptop and later presented from an unregistered one, and the record states outright that a password change does not invalidate it.',
  'support.D3.session_inventory':
    'The inventory lists SES-8842 as still active on an unregistered device and closes with the line that resetting the password terminates none of the sessions above it.',
  'support.D4.edr':
    'The report finds no malware and names the actual mechanism instead: a sideloaded extension with permission to read cookies on every site, surviving both a browser restart and a password change.',
  'support.D4.url':
    'The portal record shows the cookie was the prize the first time, which is what makes an extension able to read cookies the part of this incident that is still working.',
  'support.D5.indicator_scope':
    'The sweep found the same sender domain delivered to a second mailbox and the same extension installed on a second machine — reach that no single-account reading of the alert could have produced.',
  'support.D5.dlp':
    'The export was blocked at 62%, so part of it left the estate: that is what makes the difference between measured reach and assumed reach a difference in exposure rather than in tidiness.',
  'support.D6.session':
    'The session record is the source system answering, in its own words, whether the stolen access is still alive — which is the fact a closure rests on, not the report that a revocation was submitted.',
  'support.D6.indicator_scope':
    'The sweep is what turns "nothing else was reported" into a stated blast radius, so the next shift inherits a measured boundary instead of your assumption.',

  /* ---------------- pointer controls ---------------- */
  /* The rung labels say what the rung does, in the order the ladder climbs:
   * where to look, the idea underneath, the reasoning walked through. */
  'hint.level.1': 'Where to look',
  'hint.level.2': 'The idea it turns on',
  'hint.level.3': 'Reason it through',
  'hint.exhausted':
    'That is the last pointer for this decision. There is nothing deeper behind it — the step still missing is the one that is yours.',
  /* Said plainly because a novice assumes otherwise and then refuses the help
   * they were built the ladder for. */
  'hint.free':
    'Pointers are free. They never touch your score, and the debrief does not count how many you opened.',

  /* ---------------- first-arrival explainer: who is talking ----------------
   *
   * Read once, on first arrival. The failure it exists to prevent is a novice
   * hearing a generated line, believing the room said it, and treating it as
   * fact — so each line below names one of the three and says what kind of
   * thing it produces. `learning.intro.codex` describes the channel by the label
   * the player actually sees on it, `narration.generated`, because the model's
   * name appears nowhere on screen.
   *
   * It deliberately does NOT say that "Case guidance" is written by a model. It
   * is not: `guidance.channel` carries what the console derives from case state
   * — the last pointer, the last decision's explanation, or the welcome line —
   * and it is there whether or not an agent is connected. Saying otherwise
   * taught the player to read deterministic console text as model output, which
   * is the exact confusion these three lines exist to prevent.
   */
  'learning.intro.title': 'Three things talk to you here',
  'learning.intro.vera':
    'VERA is the operations assistant at the desk with you. She reports what is happening in the estate — operational fact, as she has it, at the moment she has it.',
  'learning.intro.codex':
    'When an agent is connected it can teach alongside you, and every line it writes is labelled "Generated guidance". It comes from outside the incident: nobody in the room said it, and it cannot change the case. Anything headed "Case guidance" is the console explaining itself, not a model.',
  'learning.intro.dashboard':
    'The dashboard is the source of truth. Where a record and a spoken line disagree, the record wins — and the record is what your result is read from.',
  'learning.intro.dismiss': 'Got it',

  /* ---------------- what the clocks do, and do not, mean ----------------
   *
   * A player who believes a wall clock is running against them rushes, and
   * rushing is the opposite of the habit this case teaches. `clock.explainer`
   * above states the same multiplier relationship for an analyst reading the
   * two clocks; these are the novice-facing form of that one fact, plus the two
   * reassurances the explainer does not make.
   */
  'clock.explain': 'How time works here',
  'clock.accelerated':
    'Incident time is accelerated: minutes pass on the incident clock while seconds pass at your desk, and each operation you run adds its own incident cost on top.',
  'clock.pause_safe':
    'Pause stops both clocks. Nothing advances behind it, nothing expires while it is held, and nothing about your case is lost.',
  'clock.no_deadline':
    'There is no hidden deadline. No wall clock is running against you and nothing is scored on how long you take, so reading a record twice costs you nothing.',

  /* ---------------- raw form of a feed row ---------------- */
  /* The disclosure that shows the untranslated technical line behind a rendered
   * feed row. Kept as a disclosure because the raw line is what a working
   * analyst eventually reads, and a novice who never sees one learns a console
   * that does not exist. */
  'activity.raw': 'Raw event line',
  'activity.raw_show': 'Show the raw event line',

  /* ---------------- closing the case ---------------- */
  /* VERA's register: what happened to the case record, and nothing else. No
   * teaching, no verdict, no number — the debrief does all three, and it does
   * them only when the player chooses to open it. */
  'close.confirm': 'That is the case closed. It is off the live board and the record is written as it stands.',
  'close.continue': 'Open the debrief when you are ready',

  /* ---------------- debrief: the teaching pass ---------------- */
  'debrief.strongest': 'Your strongest decision',
  /* The body `strongestObservation` falls back to on a run with nothing decided
   * and nothing read, and the defensive fallback `lessonObservation` uses for
   * the same emptiness. It has to read under either headline. */
  'debrief.strongest.none':
    'This run has not produced one yet — nothing has been decided and no record has been read.',
  'debrief.improve': 'The one to work on',
  'debrief.lesson': 'What it teaches',
  'debrief.time.real': 'Time at the desk',
  'debrief.time.sim': 'Time in the incident',
  'debrief.time.why':
    'The two differ because incident time runs faster than time at the desk, and every operation you ran added its own incident cost. Neither number is scored.',
  'debrief.chain': 'How your decisions led into each other',
  /* {goal} is the learning goal of the decision that most needs practice, which
   * the engine resolves into `DebriefAnalytics.replayGoal`. Naming it is the
   * whole point: "try again" sends a player back to repeat the same run. */
  'debrief.replay_goal': 'Run the case again. The one thing to get right this time: {goal}',

  /* ---------------- retrieval practice ---------------- */
  /* Optional in the strong sense, and said twice because it is offered directly
   * after a score: answering, ignoring and revealing are indistinguishable to
   * the engine, and a player who suspects otherwise will not answer honestly. */
  'retrieval.title': 'Check yourself',
  'retrieval.optional':
    'Optional, and not scored. Nothing you do here changes your result — it is here because answering from memory is what makes a thing stay learned.',
  'retrieval.reveal': 'Show the answer',
  'retrieval.answer': 'Answer',

} as const;

export type StringKey = keyof typeof en;
