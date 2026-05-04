/**
 * @module schemas
 * @description Single source of truth for the Lumina wiki vocabulary.
 * Pure data — no I/O, no imports, no side-effects.
 * Consumed by wiki.mjs, lint.mjs, and the installer template engine.
 *
 * Schema version: 0.1.0
 */

// ---------------------------------------------------------------------------
// SCHEMA_VERSION
// Bumped on every breaking change to the exported shapes.
// ---------------------------------------------------------------------------

/** @type {string} */
export const SCHEMA_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// EXEMPTION_GLOBS
// Default globs for `exempt-only` bidirectional-link mode.
// Edges whose forward target matches any of these are terminal (no reverse).
// ---------------------------------------------------------------------------

/** @type {string[]} */
export const EXEMPTION_GLOBS = [
  'foundations/**',
  'outputs/**',
  '*://*',
];

// ---------------------------------------------------------------------------
// ENUMS
// All discrete value sets consumed by lint and the config renderer.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ImportanceEntry
 * @property {number} value
 * @property {string} label
 */

/**
 * Numeric importance scale for Source pages.
 * @type {ImportanceEntry[]}
 */
const IMPORTANCE = [
  { value: 1, label: 'niche' },
  { value: 2, label: 'useful' },
  { value: 3, label: 'field-standard' },
  { value: 4, label: 'influential' },
  { value: 5, label: 'seminal' },
];

/** Valid values for the bidirectional-link enforcement mode. */
const BIDI_MODES = /** @type {const} */ (['strict', 'exempt-only', 'off']);

/** Supported wikilink syntaxes in v0.1. */
const LINK_SYNTAX = /** @type {const} */ (['obsidian']);

/** Supported slug normalisation styles. */
const SLUG_STYLE = /** @type {const} */ (['kebab-case']);

export const ENUMS = {
  IMPORTANCE,
  BIDI_MODES,
  LINK_SYNTAX,
  SLUG_STYLE,
};

// ---------------------------------------------------------------------------
// ENTITY_DIRS
// Maps entity-type slug -> { dir, pack }.
// `dir`  — relative path under wiki/ (trailing slash).
// `pack` — which pack must be installed for this entity type to be active.
// The installer skips materialising a dir when its pack is not selected.
// ---------------------------------------------------------------------------

/**
 * @typedef {'core'|'research'|'reading'} Pack
 */

/**
 * @typedef {Object} EntityDirEntry
 * @property {string} dir   - Relative path under wiki/ (trailing slash).
 * @property {Pack}   pack  - Pack that owns this entity type.
 */

/** @type {Record<string, EntityDirEntry>} */
export const ENTITY_DIRS = {
  // core pack
  sources:     { dir: 'sources/',     pack: 'core' },
  concepts:    { dir: 'concepts/',    pack: 'core' },
  people:      { dir: 'people/',      pack: 'core' },
  summary:     { dir: 'summary/',     pack: 'core' },
  outputs:     { dir: 'outputs/',     pack: 'core' },
  graph:       { dir: 'graph/',       pack: 'core' },

  // research pack
  foundations: { dir: 'foundations/', pack: 'research' },
  topics:      { dir: 'topics/',      pack: 'research' },

  // reading pack
  chapters:    { dir: 'chapters/',    pack: 'reading' },
  characters:  { dir: 'characters/',  pack: 'reading' },
  themes:      { dir: 'themes/',      pack: 'reading' },
  plot:        { dir: 'plot/',        pack: 'reading' },
};

// ---------------------------------------------------------------------------
// RAW_DIRS
// Maps raw-dir name -> pack that requires it.
// ---------------------------------------------------------------------------

/** @type {Record<string, Pack>} */
export const RAW_DIRS = {
  // core pack
  sources:    'core',
  notes:      'core',
  assets:     'core',
  tmp:        'core',
  download:   'core',

  // research pack
  discovered: 'research',
};

// ---------------------------------------------------------------------------
// EDGE_TYPES
// Each entry describes one directed edge type in the knowledge graph.
//
// Fields:
//   name               - Machine identifier (snake_case).
//   from               - Source entity type(s) — '*' means any.
//   to                 - Target entity type(s) — '*' means any.
//   reverse            - Name of the reverse edge, or null for terminal edges.
//   symmetric          - If true, the edge is stored once with sorted endpoints
//                        (forward and reverse are the same label).
//   confidenceRequired - If true, frontmatter must include a `confidence` field
//                        on the page carrying this edge.
//   terminal           - If true, no reverse edge is written (exemption applies).
//   pack               - Pack required for this edge type; 'core' for all.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EdgeType
 * @property {string}   name
 * @property {string}   from
 * @property {string}   to
 * @property {string|null} reverse
 * @property {boolean}  [symmetric]
 * @property {boolean}  [confidenceRequired]
 * @property {boolean}  [terminal]
 * @property {Pack}     pack
 */

/** @type {EdgeType[]} */
export const EDGE_TYPES = [
  // --- source <-> source ---------------------------------------------------

  // Asymmetric bibliographic citation; the cited source has no forced reverse.
  { name: 'cites',             from: 'sources', to: 'sources',  reverse: 'cited_by',          symmetric: false, pack: 'core' },
  { name: 'cited_by',         from: 'sources', to: 'sources',  reverse: 'cites',              symmetric: false, pack: 'core' },

  // Symmetric source relationships — stored once with sorted endpoints.
  { name: 'same_problem_as',  from: 'sources', to: 'sources',  reverse: 'same_problem_as',    symmetric: true,  pack: 'core' },
  { name: 'similar_method_to',from: 'sources', to: 'sources',  reverse: 'similar_method_to',  symmetric: true,  pack: 'core' },
  { name: 'complementary_to', from: 'sources', to: 'sources',  reverse: 'complementary_to',   symmetric: true,  pack: 'core' },
  { name: 'compares_against', from: 'sources', to: 'sources',  reverse: 'compares_against',   symmetric: true,  pack: 'core' },

  // Asymmetric directional source relationships.
  { name: 'builds_on',        from: 'sources', to: 'sources',  reverse: 'built_upon_by',      symmetric: false, pack: 'core' },
  { name: 'built_upon_by',    from: 'sources', to: 'sources',  reverse: 'builds_on',          symmetric: false, pack: 'core' },
  { name: 'improves_on',      from: 'sources', to: 'sources',  reverse: 'improved_by',        symmetric: false, pack: 'core' },
  { name: 'improved_by',      from: 'sources', to: 'sources',  reverse: 'improves_on',        symmetric: false, pack: 'core' },
  { name: 'challenges',       from: 'sources', to: 'sources',  reverse: 'challenged_by',      symmetric: false, pack: 'core' },
  { name: 'challenged_by',    from: 'sources', to: 'sources',  reverse: 'challenges',         symmetric: false, pack: 'core' },
  { name: 'surveys',          from: 'sources', to: 'sources',  reverse: 'surveyed_by',        symmetric: false, pack: 'core' },
  { name: 'surveyed_by',      from: 'sources', to: 'sources',  reverse: 'surveys',            symmetric: false, pack: 'core' },

  // --- source <-> concept --------------------------------------------------
  { name: 'introduces_concept', from: 'sources', to: 'concepts', reverse: 'introduced_in',   symmetric: false, pack: 'core' },
  { name: 'introduced_in',      from: 'concepts', to: 'sources', reverse: 'introduces_concept', symmetric: false, pack: 'core' },

  { name: 'uses_concept',       from: 'sources', to: 'concepts', reverse: 'used_in',         symmetric: false, pack: 'core' },
  { name: 'used_in',            from: 'concepts', to: 'sources', reverse: 'uses_concept',    symmetric: false, pack: 'core' },

  { name: 'extends_concept',    from: 'sources', to: 'concepts', reverse: 'extended_in',     symmetric: false, pack: 'core' },
  { name: 'extended_in',        from: 'concepts', to: 'sources', reverse: 'extends_concept', symmetric: false, pack: 'core' },

  { name: 'critiques_concept',  from: 'sources', to: 'concepts', reverse: 'critiqued_in',    symmetric: false, pack: 'core' },
  { name: 'critiqued_in',       from: 'concepts', to: 'sources', reverse: 'critiques_concept', symmetric: false, pack: 'core' },

  // --- source <-> person ---------------------------------------------------
  { name: 'authored_by',        from: 'sources', to: 'people',   reverse: 'authored',        symmetric: false, pack: 'core' },
  { name: 'authored',           from: 'people',  to: 'sources',  reverse: 'authored_by',     symmetric: false, pack: 'core' },

  // --- concept <-> concept -------------------------------------------------
  { name: 'related_to',         from: 'concepts', to: 'concepts', reverse: 'related_to',     symmetric: true,  pack: 'core' },
  { name: 'part_of',            from: 'concepts', to: 'concepts', reverse: 'has_part',        symmetric: false, pack: 'core' },
  { name: 'has_part',           from: 'concepts', to: 'concepts', reverse: 'part_of',         symmetric: false, pack: 'core' },

  // --- terminal edges (no reverse) — exempt-only rule applies -------------
  // Any entity -> foundations/** (research pack)
  { name: 'grounded_in',        from: '*', to: 'foundations', reverse: null, terminal: true, pack: 'research' },

  // Any entity -> outputs/** (core; outputs/ is in EXEMPTION_GLOBS)
  { name: 'produced',           from: '*', to: 'outputs',     reverse: null, terminal: true, pack: 'core' },

  // Any entity -> external URL (core; *://* is in EXEMPTION_GLOBS)
  { name: 'see_also_url',       from: '*', to: '*',           reverse: null, terminal: true, pack: 'core' },

  // --- reading pack --------------------------------------------------------
  { name: 'features',           from: 'chapters',   to: 'characters', reverse: 'appears_in',      symmetric: false, pack: 'reading' },
  { name: 'appears_in',         from: '*',          to: 'chapters',   reverse: null,              symmetric: false, pack: 'reading' },
  { name: 'tagged_with',        from: 'chapters',   to: 'themes',     reverse: 'appears_in',      symmetric: false, pack: 'reading' },
  { name: 'associated_with',    from: 'themes',     to: 'characters', reverse: 'expresses_theme', symmetric: false, pack: 'reading' },
  { name: 'expresses_theme',    from: 'characters', to: 'themes',     reverse: 'associated_with', symmetric: false, pack: 'reading' },
  { name: 'appears_with',       from: 'characters', to: 'characters', reverse: 'appears_with',    symmetric: true,  pack: 'reading' },
];

// ---------------------------------------------------------------------------
// REQUIRED_FRONTMATTER
// Per entity-type list of required YAML frontmatter fields.
// Each entry: { key, type, required, values? (for enum), pack? }
//
// `type` is one of: 'string' | 'number' | 'array' | 'enum' | 'iso-date'
// `required: false` means the key is present but optional (lint warns if absent
//   in strict mode but does not error in exempt-only mode).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FrontmatterField
 * @property {string}   key
 * @property {'string'|'number'|'array'|'enum'|'iso-date'} type
 * @property {boolean}  required
 * @property {Array}    [values]   - Allowed values for enum type.
 * @property {Pack}     [pack]     - Pack gate; absent means always required.
 */

/** @type {Record<string, FrontmatterField[]>} */
export const REQUIRED_FRONTMATTER = {
  // Shared base fields (all entity types inherit these implicitly in lint).
  _base: [
    { key: 'id',      type: 'string',   required: true  },
    { key: 'title',   type: 'string',   required: true  },
    { key: 'type',    type: 'string',   required: true  },
    { key: 'created', type: 'iso-date', required: true  },
    { key: 'updated', type: 'iso-date', required: true  },
  ],

  // Source page
  sources: [
    { key: 'id',         type: 'string',   required: true  },
    { key: 'title',      type: 'string',   required: true  },
    { key: 'type',       type: 'string',   required: true  },
    { key: 'created',    type: 'iso-date', required: true  },
    { key: 'updated',    type: 'iso-date', required: true  },
    { key: 'authors',    type: 'array',    required: true  },
    { key: 'year',       type: 'number',   required: true  },
    { key: 'importance', type: 'enum',     required: true,  values: [1, 2, 3, 4, 5] },
    { key: 'urls',       type: 'array',    required: false },
    { key: 'raw_paths',  type: 'array',    required: false },
    { key: 'provenance',    type: 'enum',  required: true,  values: ['replayable', 'partial', 'missing'] },
    { key: 'confidence',   type: 'enum',  required: false, values: ['high', 'medium', 'low', 'unverified'] },
    { key: 'ingest_status', type: 'enum', required: false, values: ['drafted', 'linted', 'verified', 'finalized'] },
    { key: 'verify_status', type: 'enum', required: false, values: ['passed', 'findings_pending', 'drift_detected', 'skipped', 'not_applicable'] },
    { key: 'findings',     type: 'array', required: false },
  ],

  // Concept page
  concepts: [
    { key: 'id',               type: 'string',   required: true  },
    { key: 'title',            type: 'string',   required: true  },
    { key: 'type',             type: 'string',   required: true  },
    { key: 'created',          type: 'iso-date', required: true  },
    { key: 'updated',          type: 'iso-date', required: true  },
    { key: 'key_sources',      type: 'array',    required: true  },
    { key: 'related_concepts', type: 'array',    required: true  },
    { key: 'confidence', type: 'enum',     required: false, values: ['high', 'medium', 'low', 'unverified'] },
  ],

  // Person page
  people: [
    { key: 'id',           type: 'string',   required: true  },
    { key: 'title',        type: 'string',   required: true  },
    { key: 'type',         type: 'string',   required: true  },
    { key: 'created',      type: 'iso-date', required: true  },
    { key: 'updated',      type: 'iso-date', required: true  },
    { key: 'key_sources',  type: 'array',    required: true  },
    { key: 'affiliations', type: 'array',    required: false },
  ],

  // Summary page (core)
  summary: [
    { key: 'id',      type: 'string',   required: true  },
    { key: 'title',   type: 'string',   required: true  },
    { key: 'type',    type: 'string',   required: true  },
    { key: 'created', type: 'iso-date', required: true  },
    { key: 'updated', type: 'iso-date', required: true  },
    { key: 'covers',  type: 'array',    required: true  },
  ],

  // Research pack: foundation page (terminal — no back-links required)
  foundations: [
    { key: 'id',      type: 'string',   required: true,  pack: 'research' },
    { key: 'title',   type: 'string',   required: true,  pack: 'research' },
    { key: 'type',    type: 'string',   required: true,  pack: 'research' },
    { key: 'created', type: 'iso-date', required: true,  pack: 'research' },
    { key: 'updated', type: 'iso-date', required: true,  pack: 'research' },
    { key: 'aliases', type: 'array',    required: false, pack: 'research' },
  ],

  // Research pack: topic page
  topics: [
    { key: 'id',          type: 'string',   required: true,  pack: 'research' },
    { key: 'title',       type: 'string',   required: true,  pack: 'research' },
    { key: 'type',        type: 'string',   required: true,  pack: 'research' },
    { key: 'created',     type: 'iso-date', required: true,  pack: 'research' },
    { key: 'updated',     type: 'iso-date', required: true,  pack: 'research' },
    { key: 'key_sources', type: 'array',    required: true,  pack: 'research' },
  ],

  // Reading pack: chapter page
  chapters: [
    { key: 'id',       type: 'string',   required: true,  pack: 'reading' },
    { key: 'title',    type: 'string',   required: true,  pack: 'reading' },
    { key: 'type',     type: 'string',   required: true,  pack: 'reading' },
    { key: 'created',  type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'updated',  type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'book',     type: 'string',   required: true,  pack: 'reading' },
    { key: 'number',   type: 'number',   required: true,  pack: 'reading' },
  ],

  // Reading pack: character page
  characters: [
    { key: 'id',        type: 'string',   required: true,  pack: 'reading' },
    { key: 'title',     type: 'string',   required: true,  pack: 'reading' },
    { key: 'type',      type: 'string',   required: true,  pack: 'reading' },
    { key: 'created',   type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'updated',   type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'book',      type: 'string',   required: true,  pack: 'reading' },
    { key: 'first_seen', type: 'string',  required: false, pack: 'reading' },
  ],

  // Reading pack: theme page
  themes: [
    { key: 'id',        type: 'string',   required: true,  pack: 'reading' },
    { key: 'title',     type: 'string',   required: true,  pack: 'reading' },
    { key: 'type',      type: 'string',   required: true,  pack: 'reading' },
    { key: 'created',   type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'updated',   type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'book',      type: 'string',   required: true,  pack: 'reading' },
  ],

  // Reading pack: plot page
  plot: [
    { key: 'id',        type: 'string',   required: true,  pack: 'reading' },
    { key: 'title',     type: 'string',   required: true,  pack: 'reading' },
    { key: 'type',      type: 'string',   required: true,  pack: 'reading' },
    { key: 'created',   type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'updated',   type: 'iso-date', required: true,  pack: 'reading' },
    { key: 'book',      type: 'string',   required: true,  pack: 'reading' },
    { key: 'up_to_chapter', type: 'number', required: true, pack: 'reading' },
  ],
};

// ---------------------------------------------------------------------------
// PACK_MANIFEST_SHAPE
// Reference contract for pack.yaml — used by v0.2 third-party packs.
// This is a documentation object, not a runtime validator.
// Keys annotated with whether they are required or optional.
// ---------------------------------------------------------------------------

/**
 * Shape contract for a third-party pack manifest (pack.yaml).
 * All top-level keys shown; nested shapes annotated inline.
 *
 * @type {Object}
 */
export const PACK_MANIFEST_SHAPE = {
  // Required: unique machine name for the pack (slug, kebab-case).
  name: 'string',

  // Required: pack release version (semver, e.g. '1.0.0').
  version: 'string',

  // Required: minimum Lumina schema version this pack is compatible with.
  // Installer refuses to activate a pack whose lumina_min_version > SCHEMA_VERSION.
  lumina_min_version: 'string',

  // Required: list of entity-type definitions the pack adds.
  // Each entry extends the ENTITY_DIRS shape.
  entities: [
    {
      // Unique entity-type slug (used as key in ENTITY_DIRS).
      type: 'string',
      // Relative path under wiki/ (trailing slash).
      dir: 'string',
      // Optional: required frontmatter fields (array of FrontmatterField).
      required_frontmatter: 'FrontmatterField[]',
    },
  ],

  // Required: list of edge-type definitions the pack adds.
  // Each entry extends the EDGE_TYPES shape.
  edge_types: [
    {
      name: 'string',
      from: 'string',
      to: 'string',
      // null for terminal edges.
      reverse: 'string | null',
      // Optional booleans; default false.
      symmetric: 'boolean?',
      terminal: 'boolean?',
    },
  ],

  // Required: list of skill slugs this pack ships (e.g. ['lumi-research-discover']).
  // Installer maps each slug to .agents/skills/lumi-<slug>/ (flat).
  skills: ['string'],

  // Optional: list of raw directory names this pack requires under raw/.
  raw_dirs: ['string'],

  // Optional: human-readable description shown during lumina install.
  description: 'string?',
};
