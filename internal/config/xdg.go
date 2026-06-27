package config

import (
	"os"
	"path/filepath"
)

// ConfigHome returns the XDG_CONFIG_HOME directory.
// If the XDG_CONFIG_HOME environment variable is set, its value is returned.
// Otherwise, it falls back to ~/.config.
func ConfigHome() string {
	if dir := os.Getenv("XDG_CONFIG_HOME"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".config")
	}
	return filepath.Join(home, ".config")
}

// DataHome returns the XDG_DATA_HOME directory.
// If the XDG_DATA_HOME environment variable is set, its value is returned.
// Otherwise, it falls back to ~/.local/share.
func DataHome() string {
	if dir := os.Getenv("XDG_DATA_HOME"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".local", "share")
	}
	return filepath.Join(home, ".local", "share")
}
