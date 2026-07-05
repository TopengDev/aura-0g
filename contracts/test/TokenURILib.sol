// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev TEST-ONLY helpers: strip a data-URI prefix, decode standard base64, and search strings, so the
///      tokenURI test suites can decode the on-chain data:application/json;base64 metadata and assert its
///      content in-suite. NOT imported by any src/ contract.
library TokenURILib {
    function afterFirstComma(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 i = 0;
        while (i < b.length && b[i] != ",") i++;
        require(i < b.length, "no comma");
        bytes memory out = new bytes(b.length - i - 1);
        for (uint256 k = 0; k < out.length; k++) out[k] = b[i + 1 + k];
        return string(out);
    }

    /// @dev Standard-alphabet base64 decode (matches OZ Base64.encode). Assumes '=' padding to a multiple of 4.
    function b64decode(string memory data) internal pure returns (string memory) {
        bytes memory b = bytes(data);
        require(b.length % 4 == 0, "bad base64 length");
        if (b.length == 0) return "";
        bytes memory table = new bytes(256);
        bytes memory alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (uint256 i = 0; i < 64; i++) table[uint8(alpha[i])] = bytes1(uint8(i));
        uint256 outLen = (b.length / 4) * 3;
        if (b[b.length - 1] == "=") outLen--;
        if (b[b.length - 2] == "=") outLen--;
        bytes memory out = new bytes(outLen);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i += 4) {
            uint256 n = (uint256(uint8(table[uint8(b[i])])) << 18)
                | (uint256(uint8(table[uint8(b[i + 1])])) << 12)
                | (uint256(uint8(table[uint8(b[i + 2])])) << 6)
                | uint256(uint8(table[uint8(b[i + 3])]));
            if (j < outLen) out[j++] = bytes1(uint8(n >> 16));
            if (j < outLen) out[j++] = bytes1(uint8(n >> 8));
            if (j < outLen) out[j++] = bytes1(uint8(n));
        }
        return string(out);
    }

    function contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 k = 0; k < n.length; k++) {
                if (h[i + k] != n[k]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory sb = bytes(s);
        bytes memory pb = bytes(prefix);
        if (pb.length > sb.length) return false;
        for (uint256 i = 0; i < pb.length; i++) {
            if (sb[i] != pb[i]) return false;
        }
        return true;
    }
}
