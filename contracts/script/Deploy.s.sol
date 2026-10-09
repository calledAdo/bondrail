// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {SliceBond} from "../src/SliceBond.sol";
import {SliceRouter} from "../src/SliceRouter.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface DeployVm {
    function envOr(string calldata, uint256) external returns (uint256);
    function envOr(string calldata, address) external returns (address);
    function addr(uint256) external returns (address);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
    function getCode(string calldata) external returns (bytes memory);
}

/// @notice Local/testnet deployment only. This script has NOT been broadcast by the implementation agent.
contract Deploy {
    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        address asset;
        address covenant;
        address factory;
        address bondImplementation;
        address routerImplementation;
        address observer;
        address milestoneSigner;
        address forwarder;
    }
    event Deployed(
        uint256 indexed chainId,
        address indexed factory,
        address asset,
        address covenant,
        address observer,
        address milestoneSigner,
        address forwarder
    );

    function run() external returns (Deployment memory d) {
        require(block.chainid == 31337 || block.chainid == 10143, "only local31337 or Monad testnet10143");
        uint256 key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        require(key != 0, "DEPLOYER_PRIVATE_KEY required");
        bool local = block.chainid == 31337;
        d.asset = vm.envOr("USDC_ADDRESS", address(0));
        d.observer = vm.envOr("OBSERVATION_SIGNER", local ? vm.addr(12345) : address(0));
        d.milestoneSigner = vm.envOr("MILESTONE_SIGNER", local ? vm.addr(67890) : address(0));
        d.forwarder = vm.envOr("CRE_FORWARDER", local ? vm.addr(99999) : address(0));
        require(
            d.observer != address(0) && d.milestoneSigner != address(0) && d.forwarder != address(0),
            "signers and forwarder required"
        );
        require(local || (d.asset.code.length != 0 && d.forwarder.code.length != 0), "verify testnet asset/forwarder");
        vm.startBroadcast(key);
        if (d.asset == address(0)) {
            MockUSDC mock = MockUSDC(_deploy("src/MockUSDC.sol:MockUSDC", ""));
            mock.mint(vm.addr(key), 1_000_000e6);
            d.asset = address(mock);
        }
        d.bondImplementation = _deploy("src/SliceBond.sol:SliceBond", "");
        d.routerImplementation = _deploy("src/SliceRouter.sol:SliceRouter", "");
        SliceCovenant c =
            SliceCovenant(_deploy("src/SliceCovenant.sol:SliceCovenant", abi.encode(d.forwarder, d.observer)));
        d.covenant = address(c);
        SliceFactory f = SliceFactory(
            _deploy(
                "src/SliceFactory.sol:SliceFactory",
                abi.encode(d.asset, d.covenant, d.milestoneSigner, d.bondImplementation, d.routerImplementation)
            )
        );
        d.factory = address(f);
        c.initializeFactory(d.factory);
        vm.stopBroadcast();
        emit Deployed(block.chainid, d.factory, d.asset, d.covenant, d.observer, d.milestoneSigner, d.forwarder);
    }

    function _deploy(string memory artifact, bytes memory args) private returns (address deployed) {
        bytes memory code = abi.encodePacked(vm.getCode(artifact), args);
        assembly { deployed := create(0, add(code, 32), mload(code)) }
        require(deployed != address(0), "deployment failed");
    }
}
