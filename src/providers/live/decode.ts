/**
 * Natsoft live-timing transport helpers.
 *
 * The browser client at /LiveMeeting/<file> opens a WebSocket to the same URL
 * (http -> ws, https -> wss) and receives packets that are obfuscated with a
 * rolling single-byte XOR starting at 0x7f. Bytes that decode below 0x20 are
 * shorthand tokens for common XML fragments. This mirrors Live_Obfs.js.
 */

const BASE_KEY = 0x7f;

/** Decode one raw WebSocket packet into its XML text. Plain XML passes through. */
export function decodePacket(data: string): string {
  if (!data || data.charAt(0) === '<') return data;
  let key = BASE_KEY;
  let out = '';
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i) ^ key;
    if (code > 31) out += String.fromCharCode(code);
    else if (code === 22) out += '><';
    else if (code === 23) out += ' T="';
    else if (code === 24) out += '="0.0000" ';
    else if (code === 25) out += '="0" ';
    else if (code === 26) out += '="" ';
    else if (code === 27) out += '" /><';
    else if (code === 28) out += '"><';
    else if (code === 29) out += '" />';
    else if (code === 30) out += '="';
    else if (code === 31) out += '" ';
    else out += String.fromCharCode(code);
    key = code;
  }
  return out;
}

/** Encode XML with the same scheme (used only in tests to build fixtures). */
export function encodePacket(xml: string): string {
  let key = BASE_KEY;
  let out = '';
  for (let i = 0; i < xml.length; i++) {
    const code = xml.charCodeAt(i);
    out += String.fromCharCode(code ^ key);
    key = code;
  }
  return out;
}

export interface ResolvedTimingUrl {
  /** Original page URL the user supplied. */
  pageUrl: string;
  /** WebSocket URL to connect to. */
  socketUrl: string;
}

/** The meeting feed this companion follows unless another URL is entered. */
export const DEFAULT_LIVE_URL = 'http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN';

/**
 * Resolve a user-supplied Natsoft timing page URL to its WebSocket endpoint.
 * Accepts http(s) page URLs (converted to ws(s) like the official client, which
 * honours ?ConnectTo= overrides) and raw ws(s) URLs. Rejects credentials,
 * non-web schemes and empty hosts so the resolver can never become an open
 * fetch proxy.
 */
export function resolveTimingUrl(input: string): ResolvedTimingUrl {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a full http:// or https:// timing URL.');
  }
  if (parsed.username || parsed.password)
    throw new Error('URLs with credentials are not accepted.');
  let socketUrl: string;
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const override = parsed.searchParams.get('ConnectTo');
    if (override) return resolveTimingUrl(override);
    socketUrl = trimmed
      .replace(/^https:/i, 'wss:')
      .replace(/^http:/i, 'ws:')
      .split('?')[0];
  } else if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
    if (!parsed.hostname) throw new Error('Enter a full timing URL with a host.');
    socketUrl = trimmed;
  } else {
    throw new Error('Only http://, https://, ws:// and wss:// timing URLs are supported.');
  }
  if (!parsed.hostname) throw new Error('Enter a full timing URL with a host.');
  return { pageUrl: trimmed, socketUrl };
}
