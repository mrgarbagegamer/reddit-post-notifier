import type { RedditPostData } from '../reddit-api/reddit-types';
import type { DocField } from './document';
import { Document } from './document';
import type { TextId } from './index';

export type SearchableField = keyof Pick<RedditPostData, 'author' | 'title' | 'selftext' | 'link_flair_text'>;
export type SearchableRedditPostData = Pick<RedditPostData, SearchableField> & { id: string | number };
export interface SearchableRedditPost {
    data: SearchableRedditPostData;
}

export interface FilterField { field: SearchableField; query: string; queryType?: 'negative' | 'positive' };
export type FilterRule = FilterField[];

export const allFields: SearchableField[] = ['title', 'selftext', 'author', 'link_flair_text'];

function getPositives(rule: FilterRule) {
    return rule.filter((r) => {
        if (!r.query)
            return false;
        return (!r.queryType || r.queryType === 'positive');
    });
}

function getNegatives(rule: FilterRule) {
    return rule.filter((r) => {
        if (!r.query)
            return false;
        return r.queryType === 'negative';
    });
}

/** Filter out posts that don't fit given search queries */
export function postFilter<T extends SearchableRedditPost>(
    posts: T[],
    queriesLists: FilterRule[],
    fields: SearchableField[] = allFields,
): T[] {
    const usedFields = fields.map((field) => {
        const result: DocField = { field };
        if (field === 'author')
            result.options = { normalize: false, stemmer: false, tokenizer: false, queryTokenizer: false };
        if (field === 'link_flair_text')
            result.options = { stemmer: false };
        return result;
    });

    const doc = new Document({ fields: usedFields, id: 'id' });
    
    // Create a fast-lookup Map and normalize IDs to strings
    const postsMap = new Map<string, T>();
    posts.forEach((p) => {
        const stringId = String(p.data.id);
        doc.add(p.data);
        postsMap.set(stringId, p);
    });

    const finalMatchedIds = new Set<string>();
    const allIds = Array.from(postsMap.keys());

    for (const qList of queriesLists) {
        if (!qList) continue;

        // Identify Regex vs Standard rules
        const regexRules = qList.filter(r => 
            typeof r.query === 'string' && /^\/.+\/[gimsuy]*$/.test(r.query)
        );
        const standardRules = qList.filter(r => 
            typeof r.query === 'string' && !/^\/.+\/[gimsuy]*$/.test(r.query)
        );

        // 1. Initial candidates from Standard Positive rules
        const positiveRules = getPositives(standardRules);
        let currentCandidates = positiveRules.length
            ? doc.search(positiveRules).map(id => String(id))
            : [...allIds];

        // 2. Remove candidates matching Standard Negative rules
        const excludeIDs = getNegatives(standardRules)
            .flatMap(r => doc.search([r]))
            .map(id => String(id));
        
        const excludeSet = new Set(excludeIDs);
        currentCandidates = currentCandidates.filter(id => !excludeSet.has(id));

        // 3. Filter remaining candidates by Regex rules
        currentCandidates.forEach((id) => {
            const post = postsMap.get(id);
            if (!post?.data) return;

            let passesRegex = true;
            for (const rule of regexRules) {
                const match = rule.query.match(/^\/(.+)\/([gimsuy]*)$/);
                if (match) {
                    try {
                        const regex = new RegExp(match[1], match[2] || 'i');
                        const textToTest = String(post.data[rule.field] || '');
                        const isMatch = regex.test(textToTest);
                        
                        if (rule.queryType === 'negative' && isMatch) passesRegex = false;
                        if (rule.queryType !== 'negative' && !isMatch) passesRegex = false;
                    } catch (e) {
                        console.warn('Regex parsing failed:', rule.query, e);
                    }
                }
                if (!passesRegex) break;
            }

            if (passesRegex) {
                finalMatchedIds.add(id);
            }
        });
    }

    return posts.filter(p => finalMatchedIds.has(String(p.data.id)));
}