# Historian Persona Findings: Configuration Data Format Evolution

## Executive Summary

The history of configuration-as-data formats reveals a clear, multi-decade arc from procedural/imperative formats toward declarative, human-readable structured data. SQL as a data interchange format is an historical anomaly -- virtually every major project that started with SQL-like or procedural configuration has migrated toward JSON, YAML, or purpose-built DSLs. The pattern of "author in format A, compile/transform to format B" is not only well-established but is arguably the dominant modern paradigm. Praxrr's current SQL ops approach, while architecturally sound for its event-sourcing semantics, sits outside the historical mainstream in a way that creates friction against ecosystem norms.

**Confidence**: High -- based on 20+ years of well-documented configuration management history across multiple ecosystems.

---

## 1. Evolution of Configuration-as-Data Formats

### 1.1 The Generational Timeline

The history of configuration management formats can be divided into five distinct generations:

**First Generation: Ad-hoc Scripts and INI Files (1980s-1990s)**

Early system configuration relied on shell scripts, INI files, and ad-hoc text formats. CFEngine, released in 1993, was the first formal configuration management tool and introduced its own promise-based language. This era established the principle that configuration needs its own representation distinct from general-purpose code.

**Confidence**: High -- well-documented computing history.

Sources:

- [CFEngine vs Puppet vs Chef vs Ansible vs Salt](https://www.rudder.io/blog/cfengine-vs-puppet-vs-chef-vs-ansible-vs-salt/)
- [Chef vs Puppet vs Ansible vs Saltstack (Edureka)](https://www.edureka.co/blog/chef-vs-puppet-vs-ansible-vs-saltstack/)

**Second Generation: Ruby DSLs (2005-2012)**

Puppet (2005) and Chef (2009) both chose Ruby-based domain-specific languages. Puppet created its own DSL that was "a mixture between JSON and Ruby," while Chef used pure Ruby recipes. Luke Kanies (Puppet's creator) articulated the rationale: DSLs exist for "compression and simplicity" -- they prevent dangerous shortcuts possible in general-purpose languages while enabling code analysis, noop modes, and enforced declarative thinking. However, Ruby DSLs had a steep learning curve and required Ruby runtime knowledge.

**Confidence**: High -- primary source from Puppet's own blog.

Sources:

- [Why Puppet Has Its Own Configuration Language](https://www.puppet.com/blog/puppet-language)
- [Puppet (software) Wikipedia](<https://en.wikipedia.org/wiki/Puppet_(software)>)

**Third Generation: The YAML Revolution (2012-2016)**

Ansible (February 2012) was the watershed moment. Creator Michael DeHaan deliberately chose YAML for accessibility: "If people aren't successful trying this out in about 30 minutes, they're going to move on." This philosophy -- that configuration should be readable by anyone, not just developers -- proved transformative. Ansible grew from zero to ~200 forks/month, overtaking Puppet and Chef. Travis CI, CircleCI, Docker Compose, and CloudFormation all adopted YAML in this era, establishing it as the de facto standard.

The YAML adoption cascade was driven by specific deficiencies in alternatives:

- XML: verbose, logic-heavy, "files so big that sometimes crashes your IDE"
- JSON: no comment support, rigid syntax
- Ruby DSLs: high learning curve, Ruby ecosystem dependency

YAML won "by default" rather than by technical superiority -- it addressed JSON's limitations (comments, readability) while avoiding XML's verbosity.

**Confidence**: High -- multiple authoritative sources including Ansible creator interviews.

Sources:

- [What is Ansible? A brief history (Windmill)](https://www.windmill.dev/blog/ansible-history)
- [Ansible (software) Wikipedia](<https://en.wikipedia.org/wiki/Ansible_(software)>)
- [Why YAML is used for configuration when it's so bad](https://kula.blog/posts/yaml/)
- [Automating in Pre-Container Times with Michael DeHaan (podcast)](https://www.lastweekinaws.com/podcast/screaming-in-the-cloud/automating-in-pre-container-times-with-michael-dehaan/)

**Fourth Generation: Purpose-Built Configuration Languages (2014-2020)**

Dissatisfaction with YAML's limitations -- particularly the "Norway Problem" (YAML 1.1 interpreting `NO` as boolean false), implicit type coercion, and the tendency to embed logic in a data format -- led to purpose-built alternatives:

- **HCL (2014)**: HashiCorp created HCL because "JSON and YAML are formats for serializing data structures, [while] HCL is a syntax and API specifically designed for building structured configuration formats." HCL evolved from HCL1 to HCL2 (Terraform 0.12) with better type handling and expression support. Critically, HCL maintained full JSON interoperability for machine-generated configs.
- **Jsonnet (2014)**: Created at Google as a refinement of internal GCL, Jsonnet adds variables, conditionals, and functions to JSON while compiling back to plain JSON/YAML.
- **Dhall (2016)**: From the Haskell ecosystem, Dhall introduced static typing to configuration, treating config as a typed system. Outputs to JSON via `dhall-to-json`.
- **CUE (2018+)**: Another Google-rooted project that unifies data and schema, using constraint-based validation rather than template expansion.

These all follow the same pattern: author in a richer format, compile to a standard interchange format (usually JSON or YAML).

**Confidence**: High -- primary sources from project documentation.

Sources:

- [HCL GitHub Repository](https://github.com/hashicorp/hcl)
- [HCL Overview (Spacelift)](https://spacelift.io/blog/hcl-hashicorp-configuration-language)
- [Taming the Beast: Comparing Jsonnet, Dhall, Cue](https://pv.wtf/posts/taming-the-beast)
- [The Configuration Complexity Curse](https://blog.cedriccharly.com/post/20191109-the-configuration-complexity-curse/)

**Fifth Generation: Specification Convergence and Schema Validation (2020-present)**

The current era emphasizes standardized specifications (Docker Compose Specification replacing v2/v3 split), JSON Schema validation, and multi-format support. Tools increasingly accept multiple input formats but standardize internal representation. Kubernetes accepts both YAML and JSON but internally uses JSON; Liquibase accepts XML, YAML, JSON, and raw SQL but stores all changes in a unified changelog model.

**Confidence**: High -- directly observable in current tool documentation.

Sources:

- [Docker Compose History](https://docs.docker.com/compose/intro/history/)
- [Liquibase Changelog Examples](https://docs.liquibase.com/concepts/changelogs/home.html)

### 1.2 Key Historical Pattern

Every generation moved toward:

1. Greater human readability
2. Separation of authoring format from runtime format
3. Declarative over imperative
4. Schema validation capabilities
5. Ecosystem tooling compatibility (editors, linters, diffing)

No major project in the last 15 years has moved FROM a structured data format (JSON/YAML) TO SQL as a configuration interchange format. The movement has been exclusively in the opposite direction.

**Confidence**: High -- based on comprehensive survey of configuration management history.

---

## 2. SQL as a Data Interchange Format: Historical Analysis

### 2.1 The Rise and Fall of SQL Dumps for Configuration

SQL dumps (sequences of INSERT/UPDATE/DELETE statements) were historically used for three primary purposes:

1. **Database backup/restore** -- the original and most legitimate use case
2. **Database migration** -- schema and data changes expressed as SQL
3. **Data seeding** -- initial population of databases with reference data

The critical historical observation is that SQL dumps were almost never used as a _human-authored configuration format_. They were typically _machine-generated_ outputs of tools like `mysqldump`, `pg_dump`, or ORM fixture exporters.

**Confidence**: High -- well-established database engineering practice.

### 2.2 The Django Fixtures Case Study (2005-2014)

Django's evolution is highly instructive for Praxrr:

- **Django 1.0 (2008)**: Supported "initial_data" fixtures in JSON, YAML, or XML format, automatically loaded on `syncdb`.
- **Django 1.7 (2014)**: Deprecated automatic fixture loading in favor of data migrations (Python code). The rationale: fixtures were "hard to maintain as models evolve, don't integrate with Django's migration system, and can't handle complex logic."
- **Django also supported raw SQL**: The `manage.py sqlcustom` command allowed raw SQL for initial data, but the documentation explicitly noted that fixtures in JSON/YAML were "a cleaner method since it's database-agnostic."

The lesson: even in a database-centric framework, structured data formats (JSON/YAML) were preferred over SQL for human-authored data, and the final evolution was toward programmatic data migrations.

**Confidence**: High -- primary Django documentation and release history.

Sources:

- [Django initial data (1.7)](https://django.readthedocs.io/en/1.7.x/howto/initial-data.html)
- [Loading Initial Data with Django 1.7+ Data Migrations](https://www.pythontutorials.net/blog/loading-initial-data-with-django-1-7-and-data-migrations/)
- [Prefer data migrations to initial data (David Winterbottom)](https://codeinthehole.com/tips/prefer-data-migrations-to-initial-data/)

### 2.3 Ruby on Rails Seeds Evolution (2008-present)

Rails followed a parallel path:

- **Early Rails**: Developers embedded seed data in migration files or used YAML fixtures
- **Rails 2.3.4 (2009)**: Introduced `db/seeds.rb` as the conventional location for seed data, written in Ruby (not SQL or YAML)
- **Modern Rails**: The community standard is Ruby code in `seeds.rb` using ActiveRecord, though YAML fixtures remain supported for testing

The trend: from YAML fixtures to programmatic Ruby, not toward SQL.

**Confidence**: High -- well-documented Rails history.

Sources:

- [Using Rails Fixtures To Seed a Database](https://brandonhilkert.com/blog/using-rails-fixtures-to-seed-a-database/)
- [Seed Data (RailsCasts #179)](http://railscasts.com/episodes/179-seed-data?view=asciicast)

### 2.4 Flyway vs. Liquibase: The SQL vs. Abstraction Debate

The database migration tool space provides the closest analogy to Praxrr's situation:

- **Flyway**: Intentionally chose SQL-only migrations. Philosophy: "SQL scripts, named correctly, in the right folder, will be applied in order." This approach is "convention over configuration" but ties migrations to a specific database dialect.
- **Liquibase**: Chose database-agnostic changelogs in XML, YAML, or JSON format. Each changeset describes _what kind of change_ rather than the SQL itself, and Liquibase generates the appropriate SQL per database. Liquibase also supports raw SQL as a fallback.

The Liquibase approach (abstract description compiled to SQL) is directly analogous to what Praxrr's migration would achieve. The historical lesson: Liquibase's format flexibility has been a significant competitive advantage, while Flyway's SQL-only approach, though simpler, has led to recent additions of TOML configuration (`flyway.toml` in 2025) to address ergonomic limitations.

**Confidence**: High -- well-documented tool comparisons.

Sources:

- [Flyway vs Liquibase (Baeldung)](https://www.baeldung.com/liquibase-vs-flyway)
- [Flyway vs Liquibase (Bytebase, 2026)](https://www.bytebase.com/blog/flyway-vs-liquibase/)

### 2.5 Event Sourcing and Append-Only Logs

Praxrr's PCD ops system bears strong resemblance to event sourcing, where "the full series of actions taken on an object" are stored in an append-only log. Key historical observations:

- Event sourcing stores use only INSERT operations, never UPDATE or DELETE on the event log itself (though Praxrr's ops include UPDATE/DELETE _target_ operations)
- Event sourcing systems universally use structured data formats (JSON, Protobuf, Avro) for event serialization, not SQL statements
- The pattern of "replay events to build current state" is well-established, but the authoring format for events is always a data serialization format, not SQL

Praxrr's approach of using SQL INSERT/UPDATE statements as the event payload is historically unusual. Most event sourcing implementations use JSON events that are then _applied_ to a database, not raw SQL that is _executed_ against a database.

**Confidence**: High -- event sourcing is extensively documented.

Sources:

- [Event Sourcing pattern (Azure)](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [CQRS, Event Sourcing Patterns (Upsolver)](https://www.upsolver.com/blog/cqrs-event-sourcing-build-database-architecture)
- [Implementing event sourcing using a relational database (SoftwareMill)](https://softwaremill.com/implementing-event-sourcing-using-a-relational-database/)

---

## 3. TRaSH-Guides and Recyclarr Format Evolution

### 3.1 TRaSH-Guides: The JSON Standard-Bearer

TRaSH-Guides has become the de facto standard for media server configuration data in the Radarr/Sonarr ecosystem. Its format evolution is directly relevant to Praxrr:

**Repository Structure (Current)**:

```
docs/json/
  radarr/
    cf/          (100+ Custom Format JSON files)
    cf-groups/   (grouped CFs for sync tools)
    quality-profiles/
  sonarr/
    cf/          (100+ Custom Format JSON files)
    cf-groups/
    quality-profiles/
```

**JSON Schema Design Choices**:

- Each Custom Format is a standalone JSON file with a `trash_id` (UUID) as immutable identifier
- Files use lowercase kebab-case naming (e.g., `uhd-bluray-tier-01.json`)
- Specifications use typed fields (`ReleaseGroupSpecification`, `SourceSpecification`, etc.)
- `trash_scores` provides context-specific scoring (default, anime, german, french, etc.)
- JSON Schema (draft-07) validates all CF definitions
- `metadata.json` and `metadata.schema.json` define the repository structure

**Key Design Decisions**:

1. One file per entity (not a monolithic dump)
2. Human-readable names and descriptions inline
3. Machine-parseable by any language with a JSON library
4. UUID-based identity for stable cross-tool references
5. Schema validation at the repository level

**February 2026 Breaking Changes**: TRaSH-Guides recently restructured their JSON format, affecting CF group semantics and quality profile ordering. This demonstrates that even the community standard evolves, but critically, the evolution happened _within_ JSON -- not away from it.

**Confidence**: High -- primary sources from TRaSH-Guides repository and documentation.

Sources:

- [TRaSH-Guides/Guides (DeepWiki)](https://deepwiki.com/TRaSH-Guides/Guides)
- [TRaSH-Guides CONTRIBUTING.md](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)
- [TRaSH-Guides metadata.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json)
- [TRaSH-Guides metadata.schema.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.schema.json)

### 3.2 Recyclarr: YAML Configuration Evolution

Recyclarr (originally "Trash Updater") has gone through eight major versions with significant YAML format evolution:

| Version | Year      | Key Format Changes                                                                                                            |
| ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| v1.x    | 2021-2022 | Initial YAML format; `names` array for custom formats                                                                         |
| v2.0    | 2022      | Renamed from Trash Updater; `trash_ids` replaced `names`; release profile restructuring; `type` property removed              |
| v3.0    | 2023      | `names` array fully removed; config file location changed to App Data Directory                                               |
| v5.0    | 2024      | `reset_unmatched_scores` moved from `custom_formats` to `quality_profiles`; `replace_existing_custom_formats` default changed |
| v7.0    | 2025      | Sonarr v3 support dropped; Release Profile syncing removed                                                                    |
| v8.0    | 2026      | `replace_existing_custom_formats` removed entirely; template includes moved to `includes/` directory                          |

**Key lessons from Recyclarr's evolution**:

1. YAML format changes are breaking but manageable with clear migration guides
2. The format has consistently moved toward more explicit, less ambiguous configuration
3. Each major version simplified the YAML structure while adding capability
4. The `!file` YAML tag was added for Docker Secrets support, showing format extensibility

**Confidence**: High -- primary sources from Recyclarr documentation and changelog.

Sources:

- [Recyclarr Version 2.0 Upgrade Guide](https://recyclarr.dev/guide/upgrade-guide/v2.0/)
- [Recyclarr Version 3.0 Upgrade Guide](https://recyclarr.dev/wiki/upgrade-guide/upgrade-guide-v3.0/)
- [Recyclarr Version 5.0 Upgrade Guide](https://recyclarr.dev/wiki/upgrade-guide/v5.0/)
- [Recyclarr Version 7.0 Upgrade Guide](https://recyclarr.dev/guide/upgrade-guide/v7.0/)
- [Recyclarr CHANGELOG.md](https://github.com/recyclarr/recyclarr/blob/master/CHANGELOG.md)

### 3.3 The Broader Media Server Automation Ecosystem

The ecosystem has converged on JSON (upstream data) + YAML (user configuration):

| Tool         | Upstream Data Format | User Config Format | Notes                                       |
| ------------ | -------------------- | ------------------ | ------------------------------------------- |
| TRaSH-Guides | JSON                 | N/A (reference)    | Community standard; 200+ CF definitions     |
| Recyclarr    | Reads TRaSH JSON     | YAML               | CLI tool; 8 major versions                  |
| Configarr    | Reads TRaSH JSON     | YAML               | Container-native; supports Lidarr, Whisparr |
| Notifiarr    | Reads TRaSH JSON     | Web UI             | Paid feature; fully automated               |
| Profilarr    | Reads TRaSH JSON     | Web UI/JSON        | GUI-first approach                          |
| Buildarr     | Reads TRaSH JSON     | YAML               | Declarative configuration                   |
| **Praxrr**   | **SQL ops**          | **SQL ops**        | **Unique in ecosystem**                     |

Praxrr is the only tool in the ecosystem that uses SQL for both upstream data and user configuration. Every other tool in the space uses JSON for data interchange and YAML for user configuration.

**Confidence**: High -- comprehensive survey of current ecosystem tools.

Sources:

- [Configarr Comparison](https://configarr.de/docs/comparison/)
- [Profilarr vs Recyclarr (2026)](https://corelab.tech/profilarr-vs-trash/)
- [TRaSH Guides: Guide Sync Tools](https://trash-guides.info/Guide-Sync/)

---

## 4. Historical Format Migration Case Studies

### 4.1 Docker Compose: Format v1 to v2 to Specification (2014-2025)

Docker Compose provides perhaps the most instructive migration case study:

**Timeline**:

- **2014**: Compose v1 CLI released (Python), Format v1 (no `services` key, flat structure)
- **2016**: Format v2 introduced `services` top-level key, networking changes
- **2017**: Format v3 added Swarm deployment options, creating confusion about v2 vs v3
- **2020**: Compose v2 CLI (Go rewrite) introduced, ignoring `version` field
- **2020+**: v2 and v3 merged into the Compose Specification
- **2025**: Compose v5 (jumped from v2 to avoid confusion with format versions)

**Key lessons**:

1. **Format versioning creates confusion**: The overlap between CLI versions and format versions caused persistent user confusion. Praxrr should consider this when planning any migration.
2. **Specification consolidation works**: Merging v2/v3 into a single specification resolved years of format fragmentation.
3. **Backward compatibility is essential but time-limited**: Old formats were supported for years before deprecation.
4. **The format stayed YAML throughout**: Despite all the versioning turmoil, Docker Compose never considered leaving YAML. The format was stable; only the schema evolved.

**Confidence**: High -- primary Docker documentation.

Sources:

- [History and development of Docker Compose](https://docs.docker.com/compose/intro/history/)
- [Docker Compose Legacy Versions](https://docs.docker.com/reference/compose-file/legacy-versions/)
- [Docker-compose.yml: from V1 to V2 (Medium)](https://medium.com/@giorgioto/docker-compose-yml-from-v1-to-v2-3c0f8bb7a48e)

### 4.2 Kubernetes: JSON to YAML Preference (2014-present)

Kubernetes represents the "author in format A, runtime uses format B" pattern at massive scale:

- **Internal representation**: JSON (API server communicates via JSON)
- **User-facing format**: YAML (official recommendation, community standard)
- **Design**: "YAML is parsed and sent to an API as JSON"
- Both formats are fully supported, but YAML is "easier for humans and is cleaner to read"
- `kubectl convert` provides format transformation between API versions

The Kubernetes precedent directly validates the "author in human-friendly format, compile/transform to machine-friendly format" approach. Notably, Kubernetes never required users to author JSON despite it being the internal format.

**Confidence**: High -- Kubernetes documentation and community practice.

Sources:

- [How to write a YAML file for Kubernetes (ARMO)](https://www.armosec.io/blog/yaml-file-for-kubernetes/)
- [K8s YAML Alternative: JSON (Jamie Phillips)](https://www.phillipsj.net/posts/k8s-yaml-alternative-json/)
- [Kubernetes Configuration Good Practices](https://kubernetes.io/docs/concepts/configuration/overview/)

### 4.3 Terraform: HCL Creation (2014) and JSON Alternative

Terraform's format history is particularly relevant because it demonstrates a project creating a _new_ format while maintaining compatibility with an existing one:

- **HCL Native**: Human-friendly syntax for authoring (`.tf` files)
- **JSON Alternative**: Machine-friendly syntax for generation (`.tf.json` files)
- **Design principle**: "Everything that can be expressed in native syntax can also be expressed in JSON syntax"
- **Explicit recommendation**: "It is not suggested that any human ever write JSON configuration for Terraform directly; that format is there only to have something that is easy to generate programmatically"

The Terraform pattern is: humans author in a rich format; machines generate in JSON; both compile to the same internal representation. This is directly analogous to what Praxrr's migration would achieve (humans author JSON/YAML; runtime compiles to SQLite).

**Confidence**: High -- primary HashiCorp documentation.

Sources:

- [Terraform JSON Configuration Syntax](https://developer.hashicorp.com/terraform/language/syntax/json)
- [Terraform Syntax Overview](https://developer.hashicorp.com/terraform/language/syntax/configuration)
- [HCL vs JSON (TechTarget)](https://www.techtarget.com/searchdatacenter/tip/HCL-vs-JSON-Configuration-language-uses-pros-and-cons)

### 4.4 Spring Framework: XML to Annotations to YAML (2004-present)

Spring's evolution spans the full arc of configuration format history:

- **Spring 1.x-2.x (2004-2009)**: XML configuration (verbose, thousands of lines common)
- **Spring 3.0 (2009)**: Annotation-based configuration (`@Configuration`, `@Bean`)
- **Spring Boot 1.0 (2014)**: `application.properties` as default, YAML as alternative
- **Spring Boot 2.4+ (2020)**: YAML adoption increased; multi-document YAML rules updated

The migration took over a decade but followed the universal pattern: verbose/formal -> concise/readable. XML configurations are still supported but rarely written by hand in new projects.

**Confidence**: High -- well-documented framework history.

Sources:

- [From XML to Annotations (Medium)](https://medium.com/@AlexanderObregon/from-xml-to-annotations-transitioning-to-modern-spring-configuration-c34e92b64ea0)
- [Using application.yml vs application.properties (Baeldung)](https://www.baeldung.com/spring-boot-yaml-vs-properties)

### 4.5 GitHub Actions Replacing Travis CI (2019-2021)

When GitHub Actions launched in November 2019 with YAML-based workflow files, it replaced Travis CI (also YAML-based) as the dominant CI/CD platform within 18 months. The YAML format was not the differentiator -- both used YAML. The lesson: format consistency with ecosystem norms reduces adoption friction. The YAML choice was considered unremarkable precisely because it was the expected format.

**Confidence**: High -- well-documented industry shift.

Sources:

- [Understanding GitHub Actions Workflow Files](https://medium.com/@amareswer/understanding-github-actions-workflow-files-yaml-explained-in-detail-76b8c7869c69)
- [Evolution of GitHub Action Workflows (academic paper)](https://bergel.eu/MyPapers/Vale22a-GitHubActionWorkflows.pdf)

---

## 5. Compile-Time Transformation Precedents

### 5.1 The Universal Pattern: Author Format != Runtime Format

The pattern of authoring in one format and compiling/transforming to another for runtime use is pervasive across software engineering. Historical examples organized by domain:

**Web Development**:

- Sass/LESS (2006/2009) -> CSS: Authors write in expressive preprocessor syntax; browsers consume CSS. "Each CSS preprocessor has its own syntax that they compile into regular CSS so that browsers can render it on the client side."
- TypeScript (2012) -> JavaScript: Authors write typed code; runtime executes untyped JavaScript. "All TypeScript-specific features like type annotations are removed, leaving behind clean JavaScript code."
- JSX (2013) -> JavaScript: Authors write HTML-like syntax; runtime executes `React.createElement()` calls.

**Data Serialization**:

- Protocol Buffers (2008 open-sourced) -> Binary wire format: Authors write `.proto` IDL files; runtime uses compact binary serialization. The `.proto` files are compiled into language-specific code that handles serialization/deserialization.
- GraphQL Schema (2015) -> Runtime type system: Authors write `.graphql` SDL files; runtime builds an executable schema.

**Infrastructure/Configuration**:

- Jsonnet (2014) -> JSON/YAML: Authors write Jsonnet with variables, functions, and conditionals; output is standard JSON/YAML consumed by Kubernetes et al.
- CUE (2018) -> JSON/YAML: Authors write constraint-based CUE; output is validated JSON/YAML.
- Dhall (2016) -> JSON/Nix/YAML: Authors write statically-typed Dhall; separate executables produce different output formats (`dhall-to-json`, `dhall-to-yaml`, `dhall-to-nix`).
- Helm Charts (2015) -> YAML manifests: Authors write Go templates with values; `helm template` produces Kubernetes YAML.
- Kustomize (2018) -> YAML manifests: Authors write overlay/patch definitions; Kustomize produces merged YAML manifests.

**Database**:

- Liquibase changelogs (XML/YAML/JSON) -> SQL: Authors write database-agnostic changesets; Liquibase generates and executes the appropriate SQL per target database.
- Django data migrations (Python) -> SQL: Authors write Python migration code; Django generates and executes SQL through the ORM.

**Confidence**: High -- all examples are well-established patterns with extensive documentation.

Sources:

- [CSS Preprocessors (Raygun)](https://raygun.com/blog/css-preprocessors-examples/)
- [How TypeScript Compilation Works (GeeksforGeeks)](https://www.geeksforgeeks.org/typescript/how-typescript-compilation-works/)
- [Protocol Buffers Overview](https://protobuf.dev/overview/)
- [Jsonnet - Kubernetes](https://jsonnet.org/articles/kubernetes.html)
- [Helm vs Kustomize (Plural)](https://www.plural.sh/blog/helm-vs-kustomize/)

### 5.2 Why Compile-Time Transformation Succeeds

Historical analysis reveals consistent reasons why the "author in A, runtime in B" pattern succeeds:

1. **Separation of concerns**: Human ergonomics and machine efficiency have different requirements. Optimizing for both in one format creates compromises.
2. **Tooling ecosystem**: Standard formats (JSON, YAML) have rich editor support, linters, schema validators, and diff tools. Custom formats lack this ecosystem.
3. **Validation at compile time**: Transformation is a natural point for validation, catching errors before they reach runtime. This is analogous to static typing.
4. **Format evolution independence**: The authoring format can evolve independently of the runtime format. Praxrr could change its JSON/YAML schema without changing the SQLite cache implementation.
5. **Multi-target output**: Once you have a structured intermediate representation, you can generate output for different targets (different database schemas, different Arr versions, export formats).

### 5.3 Praxrr's Current Position in This Pattern

Praxrr _already implements_ a compile-time transformation pattern: SQL ops files are "compiled" into an in-memory SQLite cache. The question is not whether to use the pattern, but whether the _authoring format_ (SQL) is optimal. Historical precedent overwhelmingly suggests that structured data formats (JSON/YAML) are superior authoring formats when the target is a database.

Notably, the Praxrr seed file itself was "Generated by YAML to SQL Converter" (as stated in the `0.rosettarr.sql` header), meaning the original authoring format _was_ YAML. The YAML source was then converted to SQL and the YAML was discarded. This mirrors a common anti-pattern where the human-friendly source is lost in favor of the machine-friendly output.

**Confidence**: High -- directly observable from Praxrr codebase.

---

## 6. YAML vs JSON: Historical Considerations for Praxrr

### 6.1 Known YAML Pitfalls

The historical record includes significant warnings about YAML:

- **The Norway Problem**: YAML 1.1 interprets `NO` as boolean false. Fixed in YAML 1.2, but many parsers still use 1.1 behavior.
- **Implicit Type Coercion**: Values like `22:22` parsed as sexagesimal (base 60) numbers in YAML 1.1.
- **Indentation Sensitivity**: Whitespace errors cause silent data corruption rather than parse errors.
- **Version Number Issues**: `1.0` becomes a float, not a string.
- **Specification Complexity**: YAML 1.2 spec is far more complex than JSON's.

These issues are well-documented and have led to the "noyaml" movement and tools like StrictYAML.

**Confidence**: High -- extensively documented.

Sources:

- [The YAML Document from Hell](https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell)
- [The Norway Problem (StrictYAML)](https://hitchdev.com/strictyaml/why/implicit-typing-removed/)
- [7 YAML Gotchas to Avoid (InfoWorld)](https://www.infoworld.com/article/2336307/7-yaml-gotchas-to-avoidand-how-to-avoid-them.html)
- [noyaml.com](https://noyaml.com/)

### 6.2 JSON Advantages for Data Interchange

JSON has emerged as the dominant data interchange format for good historical reasons:

- Unambiguous parsing (no implicit type coercion)
- Universal library support across all languages
- Faster parsing and lower memory consumption than YAML
- Native web compatibility
- JSON Schema provides robust validation

However, JSON lacks:

- Comments (significant for human-authored files)
- Multi-line strings (relevant for regex patterns in Praxrr's domain)
- Trailing commas (ergonomic editing issue)

### 6.3 The Ecosystem Context

TRaSH-Guides uses JSON for data interchange. Recyclarr, Configarr, Buildarr, and other tools use YAML for user configuration. The ecosystem convention is clear: **JSON for upstream data, YAML for user config**. A Praxrr migration to JSON for PCD data would align with the ecosystem standard and enable potential future interoperability with TRaSH-Guides data.

**Confidence**: High -- directly observable ecosystem norms.

---

## 7. Uncertainties and Gaps

### 7.1 Unresolved Questions

1. **Value guard semantics in JSON/YAML**: Praxrr's SQL ops use WHERE clauses as value guards for conflict detection. There is limited historical precedent for expressing this pattern in JSON/YAML. The closest analogy is optimistic concurrency control in REST APIs (ETags), but this is typically a runtime concern, not a data format concern.

2. **Append-only semantics**: While event sourcing in JSON is well-established, the specific pattern of expressing SQL UPDATE/DELETE _intentions_ in a structured format (rather than the SQL itself) has less historical precedent. This is an area where Praxrr may need to innovate rather than follow existing patterns.

3. **Migration complexity**: Historical format migrations (Docker Compose, Recyclarr) were generally tool-internal. Praxrr's migration would affect an external data repository (`praxrr-db`), which adds complexity. Django's fixture deprecation (spanning 1.7 to 1.9) suggests a multi-release transition period is appropriate.

4. **Exact TRaSH-Guides early history**: While the current JSON structure is well-documented, the early evolution of TRaSH-Guides (before ~2021) is poorly documented in publicly available sources.

### 7.2 Areas Requiring Further Research

- Performance benchmarks for JSON/YAML parsing vs. SQL execution for Praxrr's specific data volumes (~7,000 INSERT statements)
- Community sentiment analysis from Praxrr's user base regarding authoring experience
- Detailed analysis of value guard patterns in non-SQL formats (OT/CRDT literature may be relevant)

---

## 8. Summary of Historical Verdict

The historical record is clear and consistent across multiple domains spanning 30+ years:

1. **SQL as a human-authored data interchange format is an anti-pattern**. No major project outside of database administration uses SQL statements as the primary format for human-authored configuration data.

2. **The trajectory is always toward structured data formats**. Every ecosystem has moved from less structured/more imperative formats toward JSON, YAML, or purpose-built DSLs.

3. **"Author in format A, compile to format B" is the dominant modern pattern**. Kubernetes, Terraform, TypeScript, Sass, Protobuf, Helm, Jsonnet, Dhall, CUE, Liquibase, and many others all follow this pattern.

4. **The media server ecosystem has standardized on JSON + YAML**. TRaSH-Guides uses JSON; every sync tool uses YAML. Praxrr's SQL-based approach is a historical outlier.

5. **Format migrations are painful but survivable**. Docker Compose, Recyclarr, Django, Spring, and Rails all migrated formats successfully. The key ingredients are: clear migration guides, transition periods with dual format support, and compelling improvements in the new format.

6. **Praxrr already performed the inverse migration** (YAML -> SQL) and lost the YAML source. Historical precedent suggests this was the wrong direction.

**Overall Historical Confidence**: High -- the weight of evidence from 20+ years of configuration management evolution, across multiple ecosystems, is strongly and consistently in favor of structured data formats over SQL for human-authored configuration data.
