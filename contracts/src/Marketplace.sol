// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @title Marketplace - list/buy OutputNFTs with ENFORCED royalty split
/// @notice Proves the thesis: in `buy()` the EIP-2981 royalty is computed live and paid to
///         the creating agent's CURRENT owner BEFORE the seller is paid and BEFORE transfer
///         completes. In-platform => the royalty is unbypassable (honest scope: only enforced
///         for sales that go through THIS contract, build-plan §5).
contract Marketplace {
    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    IERC2981 public immutable nft; // the OutputNFT (also IERC721)
    uint16 public immutable platformBps;
    address public immutable platform;

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Sold(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        address royaltyReceiver,
        uint256 royaltyPaid,
        uint256 platformFee,
        uint256 sellerProceeds
    );

    constructor(address nftAddr, address platform_, uint16 platformBps_) {
        nft = IERC2981(nftAddr);
        platform = platform_;
        platformBps = platformBps_;
    }

    function list(uint256 tokenId, uint256 price) external {
        require(IERC721(address(nft)).ownerOf(tokenId) == msg.sender, "not owner");
        require(IERC721(address(nft)).isApprovedForAll(msg.sender, address(this)), "approve marketplace first");
        listings[tokenId] = Listing(msg.sender, price, true);
        emit Listed(tokenId, msg.sender, price);
    }

    function buy(uint256 tokenId) external payable {
        Listing memory l = listings[tokenId];
        require(l.active, "not listed");
        require(msg.value == l.price, "wrong price");

        // 1. Royalty (EIP-2981) - resolved live to the creating agent's CURRENT owner.
        (address royaltyReceiver, uint256 royaltyAmount) = nft.royaltyInfo(tokenId, l.price);
        // 2. Platform fee.
        uint256 platformFee = (l.price * platformBps) / 10_000;
        // 3. Seller proceeds = remainder.
        require(royaltyAmount + platformFee <= l.price, "fees exceed price");
        uint256 sellerProceeds = l.price - royaltyAmount - platformFee;

        listings[tokenId].active = false;

        // Pay royalty FIRST (enforced before transfer completes).
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            (bool rOk,) = payable(royaltyReceiver).call{value: royaltyAmount}("");
            require(rOk, "royalty xfer failed");
        }
        if (platformFee > 0) {
            (bool pOk,) = payable(platform).call{value: platformFee}("");
            require(pOk, "platform xfer failed");
        }
        (bool sOk,) = payable(l.seller).call{value: sellerProceeds}("");
        require(sOk, "seller xfer failed");

        // Finally transfer the NFT to the buyer.
        IERC721(address(nft)).safeTransferFrom(l.seller, msg.sender, tokenId);

        emit Sold(tokenId, msg.sender, l.seller, l.price, royaltyReceiver, royaltyAmount, platformFee, sellerProceeds);
    }
}
