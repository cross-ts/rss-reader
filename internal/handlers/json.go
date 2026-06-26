package handlers

import (
	"encoding/json"
	"net/http"
)

// writeJSON encodes data as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, statusCode int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}
