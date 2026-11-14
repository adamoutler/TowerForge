// Share links: the address a share opens from, new and old.

import { describe, expect, it } from 'vitest';
import { shareCodeFrom } from './shareApi';

describe('share links', () => {
    it('opens /s/CODE and the older ?share=CODE', () => {
        expect(shareCodeFrom('/s/ABCD2345', '')).toBe('ABCD2345');
        expect(shareCodeFrom('/s/abcd2345/', '')).toBe('ABCD2345');
        expect(shareCodeFrom('/', '?share=ABCD2345')).toBe('ABCD2345');
        expect(shareCodeFrom('/optimizer', '')).toBeNull();
        expect(shareCodeFrom('/s/ABCD2345/card.png', '')).toBeNull();
    });
});
