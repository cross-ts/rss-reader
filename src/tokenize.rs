use anyhow::Result;
use lindera::dictionary::{DictionaryKind, load_embedded_dictionary};
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use lindera::tokenizer::Tokenizer;
use std::sync::OnceLock;

/// Process-wide shared tokenizer instance.
/// The lindera IPADIC dictionary is ~50 MB; loading it once avoids repeated allocation.
fn global_tokenizer() -> &'static Tokenizer {
    static INSTANCE: OnceLock<Tokenizer> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        let dictionary = load_embedded_dictionary(DictionaryKind::IPADIC)
            .expect("Failed to load IPADIC dictionary");
        let segmenter = Segmenter::new(Mode::Normal, dictionary, None);
        Tokenizer::new(segmenter)
    })
}

pub fn tokenize(text: &str) -> Result<String> {
    if text.is_empty() {
        return Ok(String::new());
    }
    let tokenizer = global_tokenizer();
    let mut tokens = tokenizer
        .tokenize(text)
        .map_err(|e| anyhow::anyhow!("Tokenization failed: {}", e))?;
    let surfaces: Vec<String> = tokens
        .iter_mut()
        .map(|t| t.surface.as_ref().to_string())
        .collect();
    Ok(surfaces.join(" "))
}
