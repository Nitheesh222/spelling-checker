document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('editor');
    const highlights = document.getElementById('highlights');
    const backdrop = document.getElementById('backdrop');
    const charCount = document.getElementById('char-count');
    const wordCount = document.getElementById('word-count');
    const checkBtn = document.getElementById('check-btn');
    const loader = document.getElementById('loader');
    const suggestionsList = document.getElementById('suggestions-list');
    const badge = document.getElementById('issue-count-badge');

    const LANGUAGETOOL_API = 'https://api.languagetoolplus.com/v2/check';
    const LANGUAGE = 'en-US';

    let currentMatches = [];

    // Sync scrolling between editor and backdrop
    editor.addEventListener('scroll', () => {
        backdrop.scrollTop = editor.scrollTop;
        backdrop.scrollLeft = editor.scrollLeft;
    });

    // Update stats on input
    editor.addEventListener('input', () => {
        updateStats();
        // Clear highlights and results when typing heavily to avoid desync
        // In a real app, we'd debounce the API call here for live checking
        clearHighlights();
    });

    function updateStats() {
        const text = editor.value;
        charCount.textContent = `${text.length} character${text.length !== 1 ? 's' : ''}`;
        
        const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
        wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    }

    function clearHighlights() {
        highlights.innerHTML = escapeHtml(editor.value);
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function checkText() {
        const text = editor.value;
        if (!text.trim()) return;

        setLoading(true);

        try {
            const params = new URLSearchParams({
                text: text,
                language: LANGUAGE
            });

            const response = await fetch(LANGUAGETOOL_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: params
            });

            if (!response.ok) {
                throw new Error('API request failed');
            }

            const data = await response.json();
            currentMatches = data.matches;
            
            renderResults();
            applyHighlights();

        } catch (error) {
            console.error('Error checking text:', error);
            alert('Failed to check text. Please try again later.');
        } finally {
            setLoading(false);
        }
    }

    function setLoading(isLoading) {
        if (isLoading) {
            loader.classList.remove('hidden');
            checkBtn.disabled = true;
            checkBtn.style.opacity = '0.7';
        } else {
            loader.classList.add('hidden');
            checkBtn.disabled = false;
            checkBtn.style.opacity = '1';
        }
    }

    function applyHighlights() {
        let text = editor.value;
        let highlightedText = '';
        let lastIndex = 0;

        // Sort matches by offset to apply them sequentially
        const sortedMatches = [...currentMatches].sort((a, b) => a.offset - b.offset);

        sortedMatches.forEach((match, index) => {
            // Append text before the match
            highlightedText += escapeHtml(text.slice(lastIndex, match.offset));
            
            // The misspelled/grammar issue word
            const issueWord = escapeHtml(text.slice(match.offset, match.offset + match.length));
            const typeClass = match.rule.issueType === 'misspelling' ? 'misspelling' : 'grammar';
            
            highlightedText += `<mark class="${typeClass}" data-index="${index}">${issueWord}</mark>`;
            
            lastIndex = match.offset + match.length;
        });

        // Append remaining text
        highlightedText += escapeHtml(text.slice(lastIndex));
        
        // Fix trailing newlines in div to match textarea behavior
        if (text.endsWith('\n')) {
            highlightedText += '<br>';
        }

        highlights.innerHTML = highlightedText;
    }

    function renderResults() {
        if (currentMatches.length === 0) {
            badge.classList.add('hidden');
            suggestionsList.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <p>No issues found! Your text looks great.</p>
                </div>
            `;
            return;
        }

        badge.textContent = currentMatches.length;
        badge.classList.remove('hidden');
        
        // Count misspellings vs grammar for badge color
        const misspellings = currentMatches.filter(m => m.rule.issueType === 'misspelling').length;
        if (misspellings === 0) {
            badge.classList.add('warning');
        } else {
            badge.classList.remove('warning');
        }

        let html = '';
        currentMatches.forEach((match, index) => {
            const isMisspelling = match.rule.issueType === 'misspelling';
            const cardClass = isMisspelling ? 'error' : 'warning';
            const issueTypeDisplay = isMisspelling ? 'Spelling' : 'Grammar';
            
            // Format context
            const ctxText = escapeHtml(match.context.text);
            const ctxStart = match.context.offset;
            const ctxLen = match.context.length;
            
            const beforeCtx = ctxText.substring(0, ctxStart);
            const errCtx = ctxText.substring(ctxStart, ctxStart + ctxLen);
            const afterCtx = ctxText.substring(ctxStart + ctxLen);
            
            const replacements = match.replacements.slice(0, 5).map(rep => 
                `<button class="replacement-btn" onclick="applyReplacement(${index}, '${rep.value.replace(/'/g, "\\'")}')">${escapeHtml(rep.value)}</button>`
            ).join('');

            html += `
                <div class="suggestion-card ${cardClass}" id="card-${index}">
                    <div class="card-header">
                        <span class="issue-type">${issueTypeDisplay}</span>
                    </div>
                    <div class="issue-message">${escapeHtml(match.message)}</div>
                    <div class="context-str">
                        ${beforeCtx}<span class="context-err">${errCtx}</span>${afterCtx}
                    </div>
                    ${replacements ? `<div class="replacements">${replacements}</div>` : ''}
                </div>
            `;
        });

        suggestionsList.innerHTML = html;
    }

    // Expose replacement function to global scope for inline onclick handlers
    window.applyReplacement = function(matchIndex, replacementText) {
        const match = currentMatches[matchIndex];
        const text = editor.value;
        
        // Replace in editor
        const newText = text.substring(0, match.offset) + replacementText + text.substring(match.offset + match.length);
        editor.value = newText;
        updateStats();

        // We need to re-check the whole text because offsets have changed
        checkText();
    };

    // Make highlights clickable
    highlights.addEventListener('click', (e) => {
        if (e.target.tagName === 'MARK') {
            const index = e.target.getAttribute('data-index');
            const card = document.getElementById(`card-${index}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transform = 'scale(1.02)';
                setTimeout(() => card.style.transform = '', 300);
            }
        }
    });

    checkBtn.addEventListener('click', checkText);

    // Initial sync
    clearHighlights();
});
