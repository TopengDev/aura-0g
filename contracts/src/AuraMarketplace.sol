// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title AuraMarketplace - the Relic (OutputNFT) marketplace with enforced EIP-2981 royalty
/// @notice Trades the RELIC collection (OutputNFT): ONE buy() entrypoint over any allowlisted collection,
///         reading EIP-2981 royaltyInfo LIVE so a Relic's DYNAMIC owner-follows royalty pays the creating
///         agent's CURRENT owner at sale time.
///
///         AGENTS (AuraINFT) ARE NOT TRADED HERE. buy() settles with a raw ERC-721 safeTransferFrom, which
///         AuraINFT deliberately REVERTS (spec-strict ERC-7857): an agent cannot change hands without the
///         oracle re-encryption proof that re-keys its sealed brain. So agent RESALE is Flow B - the
///         server-custodian SECURE TRANSFER (AuraINFT.transfer() + the oracle's re-encryption proof) - never a
///         generic marketplace buy() (ERC-7857 cannot use one). Even if AuraINFT were allowlisted, a buy() on
///         an agent reverts ATOMICALLY at the transfer step (no funds move, no partial state) - proven by the
///         AuraINFT-buy-reverts test in AuraMarketplace.t.sol. The going-forward deploy allowlists Relics ONLY
///         (DeployCutover); the LIVE marketplace still carries AuraINFT from the original cutover - a HARMLESS
///         no-op left in place (buy reverts, no fund loss), removable later with no redeploy and no tx.
///
///         The buy() path itself is collection-generic (any EIP-2981 ERC-721 that permits a raw transfer can be
///         allowlisted); in AURA it settles Relics.
///
///         Hardening (all enforced in buy):
///           - CEI + nonReentrant (transient-storage guard, EIP-1153, cancun).
///           - Stale-listing recheck inside buy: seller must STILL own + have approved the token,
///             else the whole buy reverts atomically (buyer's funds protected).
///           - Overpay tolerated: msg.value >= price; the delta is refunded via PULL payment.
///           - Royalty cap: require(royalty + platformFee <= price).
///           - PULL PAYMENTS for ALL proceeds (royalty receiver, platform, seller, buyer refund);
///             recipients withdraw() themselves via Address.sendValue. No push transfers in buy ->
///             a hostile/contract recipient cannot brick a sale or re-enter the settlement.
///
///         Offers/bids are a documented STRETCH and intentionally NOT built here. _settleSale is a
///         private helper so a future acceptOffer can reuse the exact same split + transfer path.
contract AuraMarketplace is Ownable2Step, Pausable, ReentrancyGuardTransient, ERC721Holder {
    using Address for address payable;

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    /// @notice Hard ceiling on the platform fee so the owner can never set a confiscatory cut.
    uint16 public constant MAX_PLATFORM_BPS = 1000; // 10%

    address public immutable platform; // platform-fee beneficiary (pull)
    uint16 public platformBps;         // current platform fee in basis points (<= MAX_PLATFORM_BPS)

    /// @notice listingKey(collection, tokenId) => Listing
    mapping(bytes32 => Listing) public listings;
    /// @notice collection => allowed-to-trade
    mapping(address => bool) public allowedCollection;
    /// @notice pull-payment balances (royalty receiver / platform / seller / buyer refund)
    mapping(address => uint256) public pendingWithdrawals;

    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price);
    event PriceUpdated(address indexed collection, uint256 indexed tokenId, uint256 newPrice);
    event ListingCancelled(address indexed collection, uint256 indexed tokenId);
    event Sold(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed buyer,
        address seller,
        uint256 price,
        address royaltyReceiver,
        uint256 royaltyPaid,
        uint256 platformFee,
        uint256 sellerProceeds
    );
    event Withdrawal(address indexed who, uint256 amount);
    event PlatformBpsUpdated(uint16 newBps);
    event CollectionAllowed(address indexed collection, bool allowed);

    constructor(address platform_, uint16 platformBps_) Ownable(msg.sender) {
        require(platform_ != address(0), "platform required");
        require(platformBps_ <= MAX_PLATFORM_BPS, "platform bps too high");
        platform = platform_;
        platformBps = platformBps_;
    }

    function listingKey(address collection, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(collection, tokenId));
    }

    // ----------------------------- admin -----------------------------

    function setPlatformBps(uint16 bps) external onlyOwner {
        require(bps <= MAX_PLATFORM_BPS, "platform bps too high");
        platformBps = bps;
        emit PlatformBpsUpdated(bps);
    }

    function setAllowedCollection(address collection, bool allowed) external onlyOwner {
        require(collection != address(0), "zero collection");
        allowedCollection[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --------------------------- listings ----------------------------

    /// @notice List an owned, marketplace-approved token from an allowlisted collection.
    function list(address collection, uint256 tokenId, uint256 price) external whenNotPaused {
        require(allowedCollection[collection], "collection not allowed");
        require(price > 0, "price=0");
        require(IERC721(collection).ownerOf(tokenId) == msg.sender, "not owner");
        require(_isApproved(collection, tokenId, msg.sender), "approve marketplace first");
        listings[listingKey(collection, tokenId)] = Listing(msg.sender, price, true);
        emit Listed(collection, tokenId, msg.sender, price);
    }

    /// @notice Update the price of an active listing. Seller only.
    function updatePrice(address collection, uint256 tokenId, uint256 newPrice) external whenNotPaused {
        require(newPrice > 0, "price=0");
        bytes32 key = listingKey(collection, tokenId);
        Listing storage l = listings[key];
        require(l.active, "not listed");
        require(l.seller == msg.sender, "not seller");
        l.price = newPrice;
        emit PriceUpdated(collection, tokenId, newPrice);
    }

    /// @notice Cancel an active listing. Seller only. Allowed even while paused (so sellers can exit).
    function cancelListing(address collection, uint256 tokenId) external {
        bytes32 key = listingKey(collection, tokenId);
        Listing storage l = listings[key];
        require(l.active, "not listed");
        require(l.seller == msg.sender, "not seller");
        l.active = false;
        emit ListingCancelled(collection, tokenId);
    }

    // ----------------------------- buy -------------------------------

    /// @notice Buy a listed token. Royalty (EIP-2981, live) + platform fee + seller proceeds are all
    ///         credited as PULL balances; the NFT transfers to the buyer; overpay is refunded (pull).
    function buy(address collection, uint256 tokenId) external payable nonReentrant whenNotPaused {
        require(allowedCollection[collection], "collection not allowed");
        bytes32 key = listingKey(collection, tokenId);
        Listing memory l = listings[key];
        require(l.active, "not listed");
        require(msg.value >= l.price, "insufficient payment");

        // Stale-listing recheck: seller must STILL own the token AND still approve this marketplace.
        // (Covers the seller transferring/selling the token elsewhere, or revoking approval, AFTER
        // listing.) Revert atomically -> the buyer's funds are fully protected; no partial state.
        require(
            IERC721(collection).ownerOf(tokenId) == l.seller && _isApproved(collection, tokenId, l.seller),
            "listing stale"
        );

        // EFFECTS: deactivate before any external interaction (CEI).
        listings[key].active = false;

        // Refund any overpay to the buyer via pull.
        uint256 overpay = msg.value - l.price;
        if (overpay > 0) {
            pendingWithdrawals[msg.sender] += overpay;
        }

        _settleSale(collection, tokenId, l.price, l.seller, msg.sender);
    }

    /// @dev Royalty/fee/proceeds split + safeTransferFrom. Private so a future acceptOffer reuses it.
    ///      ALL value moves are credited to pull balances; the only external call is the NFT transfer.
    function _settleSale(address collection, uint256 tokenId, uint256 price, address seller, address buyer)
        private
    {
        // 1. Royalty (EIP-2981) - resolved live from the collection (Relic owner-follows royalty via AuraINFT).
        (address royaltyReceiver, uint256 royaltyAmount) = _royaltyInfo(collection, tokenId, price);
        // 2. Platform fee.
        uint256 platformFee = (price * platformBps) / 10_000;
        // 3. Cap: royalty + platform must not exceed price.
        require(royaltyAmount + platformFee <= price, "fees exceed price");
        // 4. Seller proceeds = remainder.
        uint256 sellerProceeds = price - royaltyAmount - platformFee;

        // Credit pull balances (no push transfers -> no brick / re-entry surface).
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            pendingWithdrawals[royaltyReceiver] += royaltyAmount;
        } else {
            // No valid royalty receiver -> fold that share back to the seller (price stays conserved).
            sellerProceeds += royaltyAmount;
            royaltyAmount = 0;
            royaltyReceiver = address(0);
        }
        if (platformFee > 0) {
            pendingWithdrawals[platform] += platformFee;
        }
        pendingWithdrawals[seller] += sellerProceeds;

        // INTERACTION: transfer the NFT to the buyer last.
        IERC721(collection).safeTransferFrom(seller, buyer, tokenId);

        emit Sold(
            collection, tokenId, buyer, seller, price, royaltyReceiver, royaltyAmount, platformFee, sellerProceeds
        );
    }

    /// @notice Withdraw accumulated pull balance (royalty/platform/seller/refund). Reentrancy-guarded.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0; // effects before interaction
        payable(msg.sender).sendValue(amount);
        emit Withdrawal(msg.sender, amount);
    }

    // ---------------------------- internal ---------------------------

    /// @dev Read EIP-2981 royalty if the collection advertises it; otherwise (0,0). Defensive: a
    ///      collection that reverts on royaltyInfo would otherwise block all of its sales.
    function _royaltyInfo(address collection, uint256 tokenId, uint256 price)
        private
        view
        returns (address receiver, uint256 amount)
    {
        try IERC165(collection).supportsInterface(type(IERC2981).interfaceId) returns (bool ok) {
            if (!ok) return (address(0), 0);
        } catch {
            return (address(0), 0);
        }
        try IERC2981(collection).royaltyInfo(tokenId, price) returns (address r, uint256 a) {
            return (r, a);
        } catch {
            return (address(0), 0);
        }
    }

    function _isApproved(address collection, uint256 tokenId, address owner_) private view returns (bool) {
        return IERC721(collection).isApprovedForAll(owner_, address(this))
            || IERC721(collection).getApproved(tokenId) == address(this);
    }
}
