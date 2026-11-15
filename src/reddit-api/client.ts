// https://www.reddit.com/dev/api/
import { mapObjToQueryStr } from '../utils/index';
import type {
    RedditAccount,
    RedditCommentResponse,
    RedditError,
    RedditMessageListing,
    RedditMessageResponse,
    RedditPostResponse,
    RedditSearchListing,
    RedditSubredditListing,
    RedditUserListing,
    RedditUserOverviewResponse,
} from './reddit-types';
import { DEV_SERVER, IS_DEV, USE_DEV_SERVER, config } from '@/constants';

type R<T> = Promise<T | RedditError>;

const RateLimitHeaders = {
    remaining: 'x-ratelimit-remaining',
    reset: 'x-ratelimit-reset',
    used: 'x-ratelimit-used',
};

export interface RateLimits {
    remaining?: number | null;
    reset?: number | null;
    used?: number | null;
}

function getRateLimits(response: Response): RateLimits {
    const rateLimits = {
        used: response.headers.get(RateLimitHeaders.used),
        reset: response.headers.get(RateLimitHeaders.reset),
        remaining: response.headers.get(RateLimitHeaders.remaining),
    };

    return {
        used: rateLimits.used ? Number.parseInt(rateLimits.used) : null,
        reset: rateLimits.reset ? Number.parseInt(rateLimits.reset) : null,
        remaining: rateLimits.remaining ? Number.parseInt(rateLimits.remaining) : null,
    };
}

export default class RedditApiClient {
    authOrigin: string;
    publicOrigin: string;
    sessionOrigin: string;
    sessionBlockedUntil = 0;
    headers: Record<string, string>;
    accessToken?: string | null;
    onRateLimits?: (rl: RateLimits) => void;
    fetchOpts: RequestInit = {
        cache: 'reload',
    };

    constructor(onRateLimits?: (rl: RateLimits) => void) {
        this.authOrigin = 'https://oauth.reddit.com';
        this.publicOrigin = 'https://www.reddit.com';
        this.sessionOrigin = 'https://api.reddit.com';
        this.headers = { Accept: 'application/json' };
        this.onRateLimits = onRateLimits;

        if (IS_DEV && USE_DEV_SERVER) {
            this.authOrigin = DEV_SERVER;
            this.publicOrigin = DEV_SERVER;
            this.sessionOrigin = DEV_SERVER;
        }
    }

    async GET(endpoint: string, queryParams: unknown = {}) {
        const params = queryParams ? queryParams as Record<string, unknown> : {};
        const query = mapObjToQueryStr({ ...params, raw_json: '1' });

        if (this.accessToken) {
            const headers: Record<string, string> = {
                ...this.headers,
                'Authorization': `bearer ${this.accessToken}`,
            };
            if (config.userAgent)
                headers['User-Agent'] = config.userAgent;

            const init: RequestInit = {
                method: 'GET',
                headers,
                ...this.fetchOpts,
            };
            const result = await fetch(encodeURI(`${this.authOrigin}${endpoint}?${query}`), init);
            if (result.ok)
                return result.json();
            try {
                return await result.json();
            }
            catch {
                throw new Error(`status code: ${result.status}. ${result.statusText}`);
            }
        }

        if (Date.now() > this.sessionBlockedUntil) {
            const init: RequestInit = {
                method: 'GET',
                credentials: 'include',
                ...this.fetchOpts,
            };
            try {
                const result = await fetch(encodeURI(`${this.sessionOrigin}${endpoint}?${query}`), init);
                if (this.onRateLimits)
                    this.onRateLimits(getRateLimits(result));
                if (result.ok)
                    return result.json();
                if (result.status === 403)
                    this.sessionBlockedUntil = Date.now() + 600000;
                else {
                    try {
                        return await result.json();
                    }
                    catch {}
                }
            }
            catch (e) {
                console.error('Session request to api.reddit.com failed', e);
            }
        }

        const init: RequestInit = {
            method: 'GET',
            headers: {
                ...this.headers,
            },
            ...this.fetchOpts,
        };
        const result = await fetch(encodeURI(`${this.publicOrigin}${endpoint}.json?${query}`), init);

        if (this.onRateLimits)
            this.onRateLimits(getRateLimits(result));

        if (result.ok)
            return result.json();

        try {
            const errorResponse = await result.json();
            return errorResponse as RedditError;
        }
        catch {
            const hint = result.status === 403
                ? ' Reddit is blocking this request - log into reddit.com in this browser or connect an account in Options'
                : '';
            throw new Error(`status code: ${result.status}. ${result.statusText}${hint}`);
        }
    }

    setAccessToken(accessToken?: string | null) {
        this.accessToken = accessToken;
    }

    getSubreddit(subreddit: string) {
        return {
            new: async (listing?: RedditSubredditListing) =>
                this.GET(`/r/${subreddit}/new`, listing) as R<RedditPostResponse>,
            search: async (listing: RedditSearchListing) => this.search(listing, subreddit),
        };
    }

    getCustomFeed(link: string) {
        link = link.trim().replace(/^\/+|\/+$/g, ''); // make sure there is no leading or trailing slash
        return {
            new: async (listing?: RedditSubredditListing) =>
                this.GET(`/user/${link}/new`, listing) as R<RedditPostResponse>,
        };
    }

    user(username: string) {
        return {
            overview: async (listing?: RedditUserListing) => {
                return this.GET(`/user/${username}/overview`, listing) as R<RedditUserOverviewResponse>;
            },
            comments: async (listing?: RedditUserListing) =>
                this.GET(`/user/${username}/comments`, listing) as R<RedditCommentResponse>,
            submitted: async (listing?: RedditUserListing) =>
                this.GET(`/user/${username}/submitted`, listing) as R<RedditPostResponse>,
        };
    }

    search(listing: RedditSearchListing, subreddit: string | null = null) {
        const listingSortByNew: RedditSearchListing = { sort: 'new', ...listing };
        if (subreddit)
            return this.GET(`/r/${subreddit}/search`, listingSortByNew) as R<RedditPostResponse>;

        return this.GET('/search', listingSortByNew) as R<RedditPostResponse>;
    }

    get messages() {
        return {
            unread: async (listing?: RedditMessageListing) =>
                this.GET('/message/unread', listing) as R<RedditMessageResponse>,
            inbox: async (listing?: RedditMessageListing) =>
                this.GET('/message/inbox', listing) as R<RedditMessageResponse>,
        };
    }

    me() {
        return this.GET('/api/me') as R<RedditAccount>;
    }
}
