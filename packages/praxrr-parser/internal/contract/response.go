package contract

// MediaType is the case-sensitive media discriminator used by /parse.
type MediaType string

const (
	MediaTypeMovie  MediaType = "movie"
	MediaTypeSeries MediaType = "series"
)

// QualitySource is emitted as the C# enum name, not its numeric ordinal.
type QualitySource string

const (
	QualitySourceUnknown   QualitySource = "Unknown"
	QualitySourceCam       QualitySource = "Cam"
	QualitySourceTelesync  QualitySource = "Telesync"
	QualitySourceTelecine  QualitySource = "Telecine"
	QualitySourceWorkprint QualitySource = "Workprint"
	QualitySourceDVD       QualitySource = "DVD"
	QualitySourceTV        QualitySource = "TV"
	QualitySourceWebDL     QualitySource = "WebDL"
	QualitySourceWebRip    QualitySource = "WebRip"
	QualitySourceBluray    QualitySource = "Bluray"
)

// Resolution is emitted as the C# enum's numeric value.
type Resolution int

const (
	ResolutionUnknown Resolution = 0
	Resolution360p    Resolution = 360
	Resolution480p    Resolution = 480
	Resolution540p    Resolution = 540
	Resolution576p    Resolution = 576
	Resolution720p    Resolution = 720
	Resolution1080p   Resolution = 1080
	Resolution2160p   Resolution = 2160
)

// QualityModifier is emitted as the C# enum name, not its numeric ordinal.
type QualityModifier string

const (
	QualityModifierNone     QualityModifier = "None"
	QualityModifierRegional QualityModifier = "Regional"
	QualityModifierScreener QualityModifier = "Screener"
	QualityModifierRawHD    QualityModifier = "RawHD"
	QualityModifierBRDisk   QualityModifier = "BRDisk"
	QualityModifierRemux    QualityModifier = "Remux"
)

// Language is emitted as the C# enum name, in parser-determined array order.
type Language string

const (
	LanguageUnknown       Language = "Unknown"
	LanguageEnglish       Language = "English"
	LanguageFrench        Language = "French"
	LanguageSpanish       Language = "Spanish"
	LanguageGerman        Language = "German"
	LanguageItalian       Language = "Italian"
	LanguageDanish        Language = "Danish"
	LanguageDutch         Language = "Dutch"
	LanguageJapanese      Language = "Japanese"
	LanguageIcelandic     Language = "Icelandic"
	LanguageChinese       Language = "Chinese"
	LanguageRussian       Language = "Russian"
	LanguagePolish        Language = "Polish"
	LanguageVietnamese    Language = "Vietnamese"
	LanguageSwedish       Language = "Swedish"
	LanguageNorwegian     Language = "Norwegian"
	LanguageFinnish       Language = "Finnish"
	LanguageTurkish       Language = "Turkish"
	LanguagePortuguese    Language = "Portuguese"
	LanguageFlemish       Language = "Flemish"
	LanguageGreek         Language = "Greek"
	LanguageKorean        Language = "Korean"
	LanguageHungarian     Language = "Hungarian"
	LanguageHebrew        Language = "Hebrew"
	LanguageLithuanian    Language = "Lithuanian"
	LanguageCzech         Language = "Czech"
	LanguageHindi         Language = "Hindi"
	LanguageRomanian      Language = "Romanian"
	LanguageThai          Language = "Thai"
	LanguageBulgarian     Language = "Bulgarian"
	LanguagePortugueseBR  Language = "PortugueseBR"
	LanguageArabic        Language = "Arabic"
	LanguageUkrainian     Language = "Ukrainian"
	LanguagePersian       Language = "Persian"
	LanguageBengali       Language = "Bengali"
	LanguageSlovak        Language = "Slovak"
	LanguageLatvian       Language = "Latvian"
	LanguageSpanishLatino Language = "SpanishLatino"
	LanguageCatalan       Language = "Catalan"
	LanguageCroatian      Language = "Croatian"
	LanguageSerbian       Language = "Serbian"
	LanguageBosnian       Language = "Bosnian"
	LanguageEstonian      Language = "Estonian"
	LanguageTamil         Language = "Tamil"
	LanguageIndonesian    Language = "Indonesian"
	LanguageTelugu        Language = "Telugu"
	LanguageMacedonian    Language = "Macedonian"
	LanguageSlovenian     Language = "Slovenian"
	LanguageMalayalam     Language = "Malayalam"
	LanguageKannada       Language = "Kannada"
	LanguageAlbanian      Language = "Albanian"
	LanguageAfrikaans     Language = "Afrikaans"
	LanguageMarathi       Language = "Marathi"
	LanguageTagalog       Language = "Tagalog"
	LanguageUrdu          Language = "Urdu"
	LanguageRomansh       Language = "Romansh"
	LanguageMongolian     Language = "Mongolian"
	LanguageGeorgian      Language = "Georgian"
	LanguageOriginal      Language = "Original"
)

// ReleaseType is emitted as the C# enum name.
type ReleaseType string

const (
	ReleaseTypeUnknown       ReleaseType = "Unknown"
	ReleaseTypeSingleEpisode ReleaseType = "SingleEpisode"
	ReleaseTypeMultiEpisode  ReleaseType = "MultiEpisode"
	ReleaseTypeSeasonPack    ReleaseType = "SeasonPack"
)

const (
	HealthStatusHealthy = "healthy"

	ErrorTitleRequired   = "Title is required"
	ErrorTypeRequired    = "Type is required and must be 'movie' or 'series'"
	ErrorTextRequired    = "Text is required"
	ErrorPatternRequired = "At least one pattern is required"
	ErrorTextsRequired   = "At least one text is required"
)

// HealthResponse is returned by GET /health.
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// ErrorResponse is returned for endpoint-level validation errors.
type ErrorResponse struct {
	Error string `json:"error"`
}

// RevisionResponse describes proper/repack/REAL revision state.
type RevisionResponse struct {
	Version  int  `json:"version"`
	Real     int  `json:"real"`
	IsRepack bool `json:"isRepack"`
}

// EpisodeResponse is the nullable episode portion of a series parse response.
type EpisodeResponse struct {
	SeriesTitle            *string     `json:"seriesTitle"`
	SeasonNumber           int         `json:"seasonNumber"`
	EpisodeNumbers         []int       `json:"episodeNumbers"`
	AbsoluteEpisodeNumbers []int       `json:"absoluteEpisodeNumbers"`
	AirDate                *string     `json:"airDate"`
	FullSeason             bool        `json:"fullSeason"`
	IsPartialSeason        bool        `json:"isPartialSeason"`
	IsMultiSeason          bool        `json:"isMultiSeason"`
	IsMiniSeries           bool        `json:"isMiniSeries"`
	Special                bool        `json:"special"`
	ReleaseType            ReleaseType `json:"releaseType"`
}

// ParseResponse is returned by POST /parse. No field uses omitempty: zero,
// empty, and null values are observable parts of the legacy wire contract.
type ParseResponse struct {
	Title         string           `json:"title"`
	Type          MediaType        `json:"type"`
	Source        QualitySource    `json:"source"`
	Resolution    Resolution       `json:"resolution"`
	Modifier      QualityModifier  `json:"modifier"`
	Revision      RevisionResponse `json:"revision"`
	Languages     []Language       `json:"languages"`
	ReleaseGroup  *string          `json:"releaseGroup"`
	MovieTitles   []string         `json:"movieTitles"`
	Year          int              `json:"year"`
	Edition       *string          `json:"edition"`
	ImdbID        *string          `json:"imdbId"`
	TmdbID        int              `json:"tmdbId"`
	HardcodedSubs *string          `json:"hardcodedSubs"`
	ReleaseHash   *string          `json:"releaseHash"`
	Episode       *EpisodeResponse `json:"episode"`
}

// MatchResponse is returned by POST /match.
type MatchResponse struct {
	Results map[string]bool `json:"results"`
}

// BatchMatchResponse is returned by POST /match/batch.
type BatchMatchResponse struct {
	Results map[string]map[string]bool `json:"results"`
}

// NewRevisionResponse returns the C# model's initialized revision default.
func NewRevisionResponse() RevisionResponse {
	return RevisionResponse{Version: 1}
}

// NewEpisodeResponse returns the C# model's initialized episode defaults.
func NewEpisodeResponse() EpisodeResponse {
	return EpisodeResponse{
		EpisodeNumbers:         []int{},
		AbsoluteEpisodeNumbers: []int{},
		ReleaseType:            ReleaseTypeUnknown,
	}
}

// NewParseResponse returns the C# model's initialized response defaults.
func NewParseResponse() ParseResponse {
	return ParseResponse{
		Revision:    NewRevisionResponse(),
		Languages:   []Language{},
		MovieTitles: []string{},
	}
}

// NewMatchResponse returns a response that encodes its results as {}, not null.
func NewMatchResponse() MatchResponse {
	return MatchResponse{Results: make(map[string]bool)}
}

// NewBatchMatchResponse returns a response that encodes its results as {}, not
// null.
func NewBatchMatchResponse() BatchMatchResponse {
	return BatchMatchResponse{Results: make(map[string]map[string]bool)}
}
