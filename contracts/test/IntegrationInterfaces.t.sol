// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondrailVault} from "../src/BondrailVault.sol";
import {IBondrailVault} from "../src/IBondrailVault.sol";
import {BondrailCreditRegistry} from "../src/BondrailCreditRegistry.sol";
import {IBondrailCreditRegistry} from "../src/IBondrailCreditRegistry.sol";

/// @notice Compile selectors against real implementations, including public getter selectors.
/// contracts:verify additionally checks every interface ABI input, output tuple and mutability.
contract IntegrationInterfacesTest {
    function testBondrailVaultSelectors() public view {
        BondrailVault real = BondrailVault(address(0));
        IBondrailVault api = IBondrailVault(address(0));
        require(api.factory.selector == real.factory.selector, "factory");
        require(api.owner.selector == real.owner.selector, "owner");
        require(api.curator.selector == real.curator.selector, "curator");
        require(api.pendingCurator.selector == real.pendingCurator.selector, "pendingCurator");
        require(api.curatorChangeAfter.selector == real.curatorChangeAfter.selector, "curatorChangeAfter");
        require(api.MAX_BOND_BPS.selector == real.MAX_BOND_BPS.selector, "MAX_BOND_BPS");
        require(api.MAX_BONDS.selector == real.MAX_BONDS.selector, "MAX_BONDS");
        require(api.MIN_IDLE_BPS.selector == real.MIN_IDLE_BPS.selector, "MIN_IDLE_BPS");
        require(api.CURATOR_DELAY.selector == real.CURATOR_DELAY.selector, "CURATOR_DELAY");
        require(api.WRITEDOWN_PERIOD.selector == real.WRITEDOWN_PERIOD.selector, "WRITEDOWN_PERIOD");
        require(api.INCOME_VESTING_PERIOD.selector == real.INCOME_VESTING_PERIOD.selector, "INCOME_VESTING_PERIOD");
        require(api.costBasis.selector == real.costBasis.selector, "costBasis");
        require(api.lockedIncome.selector == real.lockedIncome.selector, "lockedIncome");
        require(api.incomeVestingStart.selector == real.incomeVestingStart.selector, "incomeVestingStart");
        require(api.holdings.selector == real.holdings.selector, "holdings");
        require(api.idleAssets.selector == real.idleAssets.selector, "idleAssets");
        require(api.holdingRealizedValue.selector == real.holdingRealizedValue.selector, "holdingRealizedValue");
        require(api.holdingValue.selector == real.holdingValue.selector, "holdingValue");
        require(api.holdingEntryValue.selector == real.holdingEntryValue.selector, "holdingEntryValue");
        require(api.holdingRecovered.selector == real.holdingRecovered.selector, "holdingRecovered");
        require(api.entryAssets.selector == real.entryAssets.selector, "entryAssets");
        require(api.unvestedIncome.selector == real.unvestedIncome.selector, "unvestedIncome");
        require(api.checkpointIncome.selector == real.checkpointIncome.selector, "checkpointIncome");
        require(api.allocate.selector == real.allocate.selector, "allocate");
        require(api.withdrawFromRaise.selector == real.withdrawFromRaise.selector, "withdrawFromRaise");
        require(api.collect.selector == real.collect.selector, "collect");
        require(api.proposeCurator.selector == real.proposeCurator.selector, "proposeCurator");
        require(api.acceptCurator.selector == real.acceptCurator.selector, "acceptCurator");
        require(api.deposit.selector == real.deposit.selector, "deposit");
        require(api.mint.selector == real.mint.selector, "mint");
        require(api.withdraw.selector == real.withdraw.selector, "withdraw");
        require(api.redeem.selector == real.redeem.selector, "redeem");
        require(api.previewDeposit.selector == real.previewDeposit.selector, "previewDeposit");
        require(api.previewMint.selector == real.previewMint.selector, "previewMint");
        require(api.previewWithdraw.selector == real.previewWithdraw.selector, "previewWithdraw");
        require(api.previewRedeem.selector == real.previewRedeem.selector, "previewRedeem");
        require(api.maxWithdraw.selector == real.maxWithdraw.selector, "maxWithdraw");
        require(api.maxRedeem.selector == real.maxRedeem.selector, "maxRedeem");
        require(api.totalAssets.selector == real.totalAssets.selector, "totalAssets");
        require(api.convertToShares.selector == real.convertToShares.selector, "convertToShares");
        require(api.convertToAssets.selector == real.convertToAssets.selector, "convertToAssets");
        require(api.asset.selector == real.asset.selector, "asset");
        require(api.balanceOf.selector == real.balanceOf.selector, "balanceOf");
        require(api.transfer.selector == real.transfer.selector, "transfer");
        require(api.approve.selector == real.approve.selector, "approve");
    }
    function testBondrailCreditRegistrySelectors() public view {
        BondrailCreditRegistry real = BondrailCreditRegistry(address(0));
        IBondrailCreditRegistry api = IBondrailCreditRegistry(address(0));
        require(api.factory.selector == real.factory.selector, "factory");
        require(api.owner.selector == real.owner.selector, "owner");
        require(api.attester.selector == real.attester.selector, "attester");
        require(api.pendingAttester.selector == real.pendingAttester.selector, "pendingAttester");
        require(api.attesterChangeAfter.selector == real.attesterChangeAfter.selector, "attesterChangeAfter");
        require(api.MAX_BONDS.selector == real.MAX_BONDS.selector, "MAX_BONDS");
        require(api.ATTESTER_DELAY.selector == real.ATTESTER_DELAY.selector, "ATTESTER_DELAY");
        require(api.ATTESTATION_TYPEHASH.selector == real.ATTESTATION_TYPEHASH.selector, "ATTESTATION_TYPEHASH");
        require(api.recorded.selector == real.recorded.selector, "recorded");
        require(api.usedNonces.selector == real.usedNonces.selector, "usedNonces");
        require(api.recordBond.selector == real.recordBond.selector, "recordBond");
        require(api.recordedBonds.selector == real.recordedBonds.selector, "recordedBonds");
        require(api.onchainProfile.selector == real.onchainProfile.selector, "onchainProfile");
        require(api.hashAttestation.selector == real.hashAttestation.selector, "hashAttestation");
        require(api.attest.selector == real.attest.selector, "attest");
        require(api.attestedProfile.selector == real.attestedProfile.selector, "attestedProfile");
        require(api.proposeAttester.selector == real.proposeAttester.selector, "proposeAttester");
        require(api.acceptAttester.selector == real.acceptAttester.selector, "acceptAttester");
    }
}
