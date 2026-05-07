// Locale loader for the Lumina-Wiki installer.
// Pure: no globals, no I/O beyond ESM `import()` (cached by Node).
// Synchronous `t()` closure bound to one loaded locale module.

export const VALID_LOCALES = Object.freeze(['en', 'vi', 'zh']);

const LOCALE_RE = /^(en|vi|zh)$/;

function err2(msg) {
  const e = new Error(msg);
  e.code = 2;
  return e;
}

function interpolate(template, vars) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
}

async function loadStrings(locale) {
  let mod;
  try {
    mod = await import(`./locales/${locale}.mjs`);
  } catch (cause) {
    throw err2(`Failed to load locale module '${locale}': ${cause.message}`);
  }
  const strings = mod.default;
  if (!strings || typeof strings !== 'object') {
    throw err2(`Locale module '${locale}' has no default export object`);
  }
  return { strings, meta: mod._meta ?? null };
}

export async function loadLocale(locale) {
  if (typeof locale !== 'string' || !LOCALE_RE.test(locale)) {
    throw err2(`Invalid locale: ${JSON.stringify(locale)}. Must be one of: ${VALID_LOCALES.join(', ')}`);
  }
  const { strings, meta } = await loadStrings(locale);
  // EN fallback strings — used only when a key is missing in the chosen locale.
  // Loaded ONCE per loadLocale call; cached by Node's ESM module cache after.
  // For dev-time strictness the parity test in CI ensures this fallback never
  // fires in production; runtime behavior is "warn + EN" instead of "throw".
  let enFallback = null;
  if (locale !== 'en') {
    try {
      enFallback = (await loadStrings('en')).strings;
    } catch {
      enFallback = null;
    }
  }
  const warned = new Set();
  const t = (key, vars) => {
    if (key in strings) {
      return interpolate(strings[key], vars);
    }
    if (enFallback && key in enFallback) {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[i18n] missing key '${key}' in locale '${locale}', using EN fallback`);
      }
      return interpolate(enFallback[key], vars);
    }
    throw new Error(`Missing translation key '${key}' in locale '${locale}'`);
  };
  const keys = () => Object.keys(strings);
  return { locale, t, keys, _meta: meta };
}
