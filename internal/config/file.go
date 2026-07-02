package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// FileConfig mirrors config.yml. All fields are optional (pointers) so we can
// tell whether a key was present in the file.
type FileConfig struct {
	Host                *string `yaml:"host"`
	Port                *int    `yaml:"port"`
	PollIntervalMinutes *uint64 `yaml:"poll_interval_minutes"`
	DB                  *string `yaml:"db"`
	Feeds               *string `yaml:"feeds"`
	FrontendURL         *string `yaml:"frontend_url"`
	StaticDir           *string `yaml:"static_dir"`
}

// FilePath returns the path to config.yml under XDG_CONFIG_HOME.
func FilePath() string {
	return filepath.Join(ConfigHome(), "rss-reader", "config.yml")
}

// LoadFile reads and parses config.yml at path. If the file does not exist,
// it returns a zero-value FileConfig and no error.
func LoadFile(path string) (*FileConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &FileConfig{}, nil
		}
		return nil, fmt.Errorf("reading config file %q: %w", path, err)
	}

	var fc FileConfig
	if err := yaml.Unmarshal(data, &fc); err != nil {
		return nil, fmt.Errorf("parsing config file %q: %w", path, err)
	}

	return &fc, nil
}

// SaveFile writes fc to path as YAML, atomically (temp file + rename),
// creating parent directories as needed.
func SaveFile(path string, fc *FileConfig) error {
	data, err := yaml.Marshal(fc)
	if err != nil {
		return fmt.Errorf("marshaling config file: %w", err)
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating config directory %q: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".config-*.yml")
	if err != nil {
		return fmt.Errorf("creating temp config file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath) // no-op after successful rename

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("writing temp config file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("closing temp config file: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("renaming temp config file to %q: %w", path, err)
	}

	return nil
}
