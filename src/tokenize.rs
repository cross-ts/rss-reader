use anyhow::Result;
use lindera::dictionary::{DictionaryKind, load_embedded_dictionary};
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use lindera::tokenizer::Tokenizer;

pub fn tokenize(text: &str) -> Result<String> {
    if text.is_empty() {
        return Ok(String::new());
    }
    let dictionary = load_embedded_dictionary(DictionaryKind::IPADIC)
        .map_err(|e| anyhow::anyhow!("Failed to load IPADIC dictionary: {}", e))?;
    let segmenter = Segmenter::new(Mode::Normal, dictionary, None);
    let tokenizer = Tokenizer::new(segmenter);
    let mut tokens = tokenizer.tokenize(text)
        .map_err(|e| anyhow::anyhow!("Tokenization failed: {}", e))?;
    let surfaces: Vec<String> = tokens.iter_mut().map(|t| t.surface.as_ref().to_string()).collect();
    Ok(surfaces.join(" "))
}
