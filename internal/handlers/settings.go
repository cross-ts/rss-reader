package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/cross-ts/rss-reader/internal/config"
)

// SettingItem is the JSON representation of a single configuration value.
type SettingItem struct {
	Value           any    `json:"value"`
	Source          string `json:"source"`
	Editable        bool   `json:"editable"`
	RestartRequired bool   `json:"restartRequired"`
}

// SettingsResponse is the JSON response for GET /api/settings.
type SettingsResponse struct {
	Host                SettingItem `json:"host"`
	Port                SettingItem `json:"port"`
	PollIntervalMinutes SettingItem `json:"pollIntervalMinutes"`
	FrontendURL         SettingItem `json:"frontendUrl"`
	DB                  SettingItem `json:"db"`
	Feeds               SettingItem `json:"feeds"`
	StaticDir           SettingItem `json:"staticDir"`
}

func settingsResponse(cfg *config.Config) SettingsResponse {
	return SettingsResponse{
		Host:                SettingItem{Value: cfg.Host, Source: string(cfg.Sources["host"]), Editable: true, RestartRequired: true},
		Port:                SettingItem{Value: cfg.Port, Source: string(cfg.Sources["port"]), Editable: true, RestartRequired: true},
		PollIntervalMinutes: SettingItem{Value: cfg.PollIntervalMinutes, Source: string(cfg.Sources["poll_interval_minutes"]), Editable: true, RestartRequired: true},
		FrontendURL:         SettingItem{Value: cfg.FrontendURL, Source: string(cfg.Sources["frontend_url"]), Editable: true, RestartRequired: true},
		DB:                  SettingItem{Value: cfg.DBPath, Source: string(cfg.Sources["db"]), Editable: false, RestartRequired: true},
		Feeds:               SettingItem{Value: cfg.FeedsPath, Source: string(cfg.Sources["feeds"]), Editable: false, RestartRequired: true},
		StaticDir:           SettingItem{Value: cfg.StaticDir, Source: string(cfg.Sources["static_dir"]), Editable: false, RestartRequired: true},
	}
}

// GetSettings returns an http.HandlerFunc that reports the effective
// configuration, its source, and editability for the Web UI settings screen.
func GetSettings(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, settingsResponse(cfg))
	}
}

// settingsUpdateRequest is the JSON body for PUT /api/settings. Only editable
// keys may be present; pointers distinguish "not sent" from zero values.
type settingsUpdateRequest struct {
	Host                *string `json:"host"`
	Port                *int    `json:"port"`
	PollIntervalMinutes *uint64 `json:"pollIntervalMinutes"`
	FrontendURL         *string `json:"frontendUrl"`

	// Non-editable keys: if present at all, the request is rejected.
	DB        *string `json:"db"`
	Feeds     *string `json:"feeds"`
	StaticDir *string `json:"staticDir"`
}

func validateFrontendURL(raw string) error {
	if err := config.ValidateFrontendURL(raw); err != nil {
		return fmt.Errorf("invalid frontend URL: %w", err)
	}
	return nil
}

// UpdateSettings returns an http.HandlerFunc that validates and persists
// editable settings to config.yml. Path-based settings (db, feeds, staticDir)
// are read-only and rejected if present in the request body.
func UpdateSettings(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body settingsUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if body.DB != nil || body.Feeds != nil || body.StaticDir != nil {
			http.Error(w, "db, feeds, and staticDir are not editable", http.StatusBadRequest)
			return
		}

		if body.Host != nil && strings.TrimSpace(*body.Host) == "" {
			http.Error(w, "host must not be empty", http.StatusBadRequest)
			return
		}
		if body.Port != nil && (*body.Port < 1 || *body.Port > 65535) {
			http.Error(w, "port must be between 1 and 65535", http.StatusBadRequest)
			return
		}
		if body.PollIntervalMinutes != nil && (*body.PollIntervalMinutes < 1 || *body.PollIntervalMinutes > config.MaxPollIntervalMinutes) {
			http.Error(w, fmt.Sprintf("pollIntervalMinutes must be between 1 and %d", config.MaxPollIntervalMinutes), http.StatusBadRequest)
			return
		}
		if body.FrontendURL != nil {
			if err := validateFrontendURL(*body.FrontendURL); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}

		path := config.FilePath()
		fileCfg, err := config.LoadFile(path)
		if err != nil {
			slog.Error("load config file for update", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		if body.Host != nil {
			fileCfg.Host = body.Host
		}
		if body.Port != nil {
			fileCfg.Port = body.Port
		}
		if body.PollIntervalMinutes != nil {
			fileCfg.PollIntervalMinutes = body.PollIntervalMinutes
		}
		if body.FrontendURL != nil {
			fileCfg.FrontendURL = body.FrontendURL
		}

		if err := config.SaveFile(path, fileCfg); err != nil {
			slog.Error("save config file", "error", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
