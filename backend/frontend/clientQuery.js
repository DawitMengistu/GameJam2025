/**
 * Lightweight React-Query-style cache for vanilla JS (no bundler).
 * Use for friends now; history and other GETs later via the same keys API.
 *
 * Global: window.createQueryClient
 */
(function (global) {
    function createQueryClient(opts = {}) {
        const defaultStaleTime =
            typeof opts.defaultStaleTime === 'number'
                ? opts.defaultStaleTime
                : 60_000;

        /** @type {Map<string, { data: any, fetchedAt: number, stale: boolean }>} */
        const entries = new Map();
        /** @type {Map<string, Promise<any>>} */
        const inflight = new Map();

        function getEntry(key) {
            return entries.get(String(key)) || null;
        }

        function isFresh(entry, staleTime) {
            if (!entry || entry.stale) return false;
            return Date.now() - entry.fetchedAt < staleTime;
        }

        return {
            getQueryData(key) {
                return getEntry(key)?.data;
            },

            setQueryData(key, dataOrUpdater) {
                const k = String(key);
                const prev = getEntry(k);
                const nextData =
                    typeof dataOrUpdater === 'function'
                        ? dataOrUpdater(prev?.data)
                        : dataOrUpdater;
                entries.set(k, {
                    data: nextData,
                    fetchedAt: prev?.fetchedAt || Date.now(),
                    stale: false,
                });
                return nextData;
            },

            invalidate(key) {
                const k = String(key);
                const entry = getEntry(k);
                if (entry) {
                    entry.stale = true;
                    entries.set(k, entry);
                }
            },

            clear(key) {
                if (key == null) {
                    entries.clear();
                    inflight.clear();
                    return;
                }
                const k = String(key);
                entries.delete(k);
                inflight.delete(k);
            },

            /**
             * @param {string} key
             * @param {() => Promise<any>} fetcher
             * @param {{ staleTime?: number, force?: boolean }} [options]
             */
            async fetchQuery(key, fetcher, options = {}) {
                const k = String(key);
                const staleTime =
                    typeof options.staleTime === 'number'
                        ? options.staleTime
                        : defaultStaleTime;
                const force = Boolean(options.force);

                const existing = getEntry(k);
                if (!force && isFresh(existing, staleTime)) {
                    return existing.data;
                }

                if (inflight.has(k)) {
                    return inflight.get(k);
                }

                const promise = Promise.resolve()
                    .then(() => fetcher())
                    .then((data) => {
                        entries.set(k, {
                            data,
                            fetchedAt: Date.now(),
                            stale: false,
                        });
                        return data;
                    })
                    .finally(() => {
                        inflight.delete(k);
                    });

                inflight.set(k, promise);
                return promise;
            },
        };
    }

    global.createQueryClient = createQueryClient;
})(typeof window !== 'undefined' ? window : globalThis);
