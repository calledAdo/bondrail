// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "./TestBase.sol";
import {VaultTest} from "./Vault.t.sol";
import {BondrailVaultFactory, BondrailNamedVault} from "../src/BondrailVaultFactory.sol";
import {IBondrailVaultFactory} from "../src/IBondrailVaultFactory.sol";
import {BondrailVault} from "../src/BondrailVault.sol";
import {BondrailFactory} from "../src/BondrailFactory.sol";
import {BondrailBond} from "../src/BondrailBond.sol";

/// @dev Re-runs every vault economics/security test through the factory-created vault as well.
contract VaultFactoryTest is VaultTest {
    BondrailVaultFactory registry;
    BondrailVault legacy;
    event VaultCreated(
        address indexed vault,
        address indexed asset,
        address indexed curator,
        address owner,
        string name,
        string symbol,
        IBondrailVaultFactory.Strategy strategy
    );

    function setUp() public override {
        super.setUp();
        legacy = vault;
        registry = new BondrailVaultFactory(factory, address(this));
        vault = BondrailVault(_create("Native revenue", "NATIVE"));
        vm.prank(ALICE);
        asset.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        asset.approve(address(vault), type(uint256).max);
    }

    function _create(string memory description, string memory symbol) internal returns (address) {
        return registry.createVault(
            address(asset),
            description,
            symbol,
            CURATOR,
            address(this),
            IBondrailVaultFactory.Strategy(description, keccak256(bytes(description)))
        );
    }

    function testCreationMetadataProtocolAndRegistry() public {
        eq(registry.vaultCount(), 1);
        yes(registry.isVault(address(vault)));
        eq(address(vault.factory()), address(factory));
        eq(vault.asset(), address(asset));
        eq(vault.owner(), address(this));
        eq(vault.curator(), CURATOR);
        yes(keccak256(bytes(vault.name())) == keccak256("Native revenue"));
        yes(keccak256(bytes(vault.symbol())) == keccak256("NATIVE"));
        yes(registry.strategy(address(vault)).metadataHash == keccak256("Native revenue"));
        address second = _create("Watched revenue", "WATCH");
        yes(second != address(vault));
        eq(registry.vaultCount(), 2);
        eq(registry.vaults(0, 1)[0], address(vault));
        eq(registry.vaults(1, 100)[0], second);
        eq(registry.vaults(2, 100).length, 0);
        eq(registry.vaults(type(uint256).max, 100).length, 0);
        vm.expectRevert(BondrailVaultFactory.InvalidPage.selector);
        registry.vaults(0, 0);
        vm.expectRevert(BondrailVaultFactory.InvalidPage.selector);
        registry.vaults(0, 101);
    }

    function testCreateEvent() public {
        vm.recordLogs();
        address created = _create("New mandate", "NEW");
        // Constructor CuratorChanged precedes VaultCreated; indexers must use event's current curator.
        _checkLog(created);
    }

    function _checkLog(address created) internal {
        // Verify exact tuple payload and indexed fields.
        bytes32 topic = keccak256("VaultCreated(address,address,address,address,string,string,(string,bytes32))");
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(registry) || logs[i].topics[0] != topic) continue;
            eq(address(uint160(uint256(logs[i].topics[1]))), created);
            eq(address(uint160(uint256(logs[i].topics[2]))), address(asset));
            eq(address(uint160(uint256(logs[i].topics[3]))), CURATOR);
            (address own, string memory name, string memory symbol, IBondrailVaultFactory.Strategy memory s) =
                abi.decode(logs[i].data, (address, string, string, IBondrailVaultFactory.Strategy));
            eq(own, address(this));
            yes(keccak256(bytes(name)) == keccak256("New mandate"));
            yes(keccak256(bytes(symbol)) == keccak256("NEW"));
            yes(s.metadataHash == keccak256("New mandate"));
            found = true;
        }
        yes(found);
    }

    function testRegisterExistingOnceOwnerOnly() public {
        vm.prank(ALICE);
        vm.expectRevert(BondrailVaultFactory.Unauthorized.selector);
        registry.registerExisting(address(legacy));
        registry.registerExisting(address(legacy));
        yes(registry.existingRegistered());
        yes(registry.isVault(address(legacy)));
        eq(registry.vaultCount(), 2);
        vm.expectRevert(BondrailVaultFactory.AlreadyRegistered.selector);
        registry.registerExisting(address(legacy));
        BondrailVault another = new BondrailVault(asset, factory, address(this), CURATOR);
        vm.expectRevert(BondrailVaultFactory.AlreadyRegistered.selector);
        registry.registerExisting(address(another));
    }

    function testRegisterRejectsNamedAndWrongProtocolAndEOA() public {
        vm.expectRevert(BondrailVaultFactory.InvalidVault.selector);
        registry.registerExisting(ALICE);
        BondrailNamedVault named = new BondrailNamedVault(asset, factory, address(this), CURATOR, "Spoof", "S");
        vm.expectRevert(BondrailVaultFactory.InvalidVault.selector);
        registry.registerExisting(address(named));
        // Has the same public views but is not the exact original implementation.
        BondrailVault wrong = new BondrailVault(asset, BondrailFactory(address(registry)), address(this), CURATOR);
        vm.expectRevert(BondrailVaultFactory.InvalidVault.selector);
        registry.registerExisting(address(wrong));
        yes(!registry.existingRegistered());
        registry.registerExisting(address(legacy));
    }

    function testInvalidCreationConfiguration() public {
        IBondrailVaultFactory.Strategy memory s = IBondrailVaultFactory.Strategy("Revenue", bytes32(0));
        vm.expectRevert(BondrailVaultFactory.InvalidConfiguration.selector);
        registry.createVault(ALICE, "Name", "N", CURATOR, address(this), s);
        vm.expectRevert(BondrailVaultFactory.InvalidConfiguration.selector);
        registry.createVault(address(asset), "", "N", CURATOR, address(this), s);
        vm.expectRevert(BondrailVaultFactory.InvalidConfiguration.selector);
        registry.createVault(address(asset), "N", "12345678901234567", CURATOR, address(this), s);
        vm.expectRevert(BondrailVault.InvalidConfiguration.selector);
        registry.createVault(address(asset), "Name", "N", address(0), address(this), s);
        vm.expectRevert(BondrailVault.InvalidConfiguration.selector);
        registry.createVault(address(asset), "Name", "N", CURATOR, address(0), s);
        vm.expectRevert(BondrailVaultFactory.InvalidConfiguration.selector);
        registry.createVault(
            address(asset), "Name", "N", CURATOR, address(this), IBondrailVaultFactory.Strategy("", bytes32(0))
        );
    }

    function testFuzzMetadataBound(uint16 length) public {
        uint256 n = uint256(length) % 600;
        if (n == 0 || n > 280) vm.expectRevert(BondrailVaultFactory.InvalidConfiguration.selector);
        registry.createVault(
            address(asset),
            "Name",
            "N",
            CURATOR,
            address(this),
            IBondrailVaultFactory.Strategy(string(new bytes(n)), bytes32(0))
        );
    }

    function testFuzzFixedConcentrationCannotLoosen(uint64 input) public {
        uint256 amount = 1 + uint256(input) % 1000e6;
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 1000e6);
        if (amount > 250e6) vm.expectRevert(BondrailVault.ConcentrationLimit.selector);
        _allocate(b, amount);
        eq(vault.MAX_BOND_BPS(), 2500);
        eq(vault.MAX_BONDS(), 16);
        eq(vault.MIN_IDLE_BPS(), 2000);
        // No owner or curator method can loosen a mandate; these are compile-time constants.
        (bool ok,) = address(vault).call(abi.encodeWithSignature("setLimits(uint256,uint256,uint256)", 10000, 100, 0));
        yes(!ok);
    }
}
