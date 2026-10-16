# Request waterfalls

25 seconds from navigation. Times are milliseconds. Browser request start/completion includes connection setup, CORS and transfer. HTTP requests can contain multiple JSON-RPC calls and nested multicalls. `server GraphQL` is the first route read, measured on the server (including a cache lookup); its duration is embedded in the HTML. Cold uses a new browser context; warm reload retains HTTP cache and resets React Query.

## before-production — cold

Summary: 5037 ms; full terms sentence: 5037 ms.

| Request | Start | Duration | Work |
|---|---:|---:|---|
| 1. GraphQL | 1991 | 984 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 2. registry | 2978 | 369 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 3. RPC | 3424 | 923 | decimals, symbol |
| 4. RPC | 4416 | 173 | nativeApproved, templateOf, nativeApproved, templateOf |
| 5. RPC | 4658 | 165 | nativeTemplate, nativeTemplate |
| 6. RPC | 4857 | 165 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 7. RPC | 5072 | 158 | eth_blockNumber, covenant |
| 8. RPC | 5299 | 179 | onchainProfile, attestedProfile, attester, darkFor |
| 9. RPC | 5546 | 162 | decimals, symbol |
| 10. GraphQL | 15027 | 407 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 11. registry | 15434 | 387 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 12. RPC | 15890 | 300 | decimals, symbol |
| 13. RPC | 16259 | 181 | nativeApproved, templateOf, nativeApproved, templateOf |
| 14. RPC | 16510 | 166 | nativeTemplate, nativeTemplate |
| 15. RPC | 16714 | 185 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 16. RPC | 20547 | 209 | darkFor |

## before-production — warm

Summary: 2512 ms; full terms sentence: 2512 ms.

| Request | Start | Duration | Work |
|---|---:|---:|---|
| 1. GraphQL | 414 | 306 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 2. registry | 721 | 366 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 3. RPC | 1157 | 333 | decimals, symbol |
| 4. RPC | 1558 | 172 | nativeApproved, templateOf, nativeApproved, templateOf |
| 5. RPC | 1799 | 449 | nativeTemplate, nativeTemplate |
| 6. RPC | 2281 | 222 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 7. RPC | 2547 | 188 | eth_blockNumber, covenant |
| 8. RPC | 2804 | 211 | onchainProfile, attestedProfile, attester, darkFor |
| 9. RPC | 3084 | 229 | decimals, symbol |
| 10. GraphQL | 12507 | 744 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 11. registry | 13251 | 453 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 12. RPC | 13775 | 369 | decimals, symbol |
| 13. RPC | 14213 | 168 | nativeApproved, templateOf, nativeApproved, templateOf |
| 14. RPC | 14449 | 161 | nativeTemplate, nativeTemplate |
| 15. RPC | 14644 | 175 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 16. RPC | 18086 | 204 | darkFor |
| 17. GraphQL | 24822 | pending at cutoff | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |

## before-local — cold

Summary: 4736 ms; full terms sentence: 4736 ms.

| Request | Start | Duration | Work |
|---|---:|---:|---|
| 1. GraphQL | 169 | 1235 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 2. registry | 1404 | 869 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 3. RPC | 2343 | 826 | decimals, symbol |
| 4. RPC | 3238 | 759 | nativeApproved, templateOf, nativeApproved, templateOf |
| 5. RPC | 4068 | 435 | nativeTemplate, nativeTemplate |
| 6. RPC | 4535 | 178 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 7. RPC | 4771 | 176 | eth_blockNumber, covenant |
| 8. RPC | 5017 | 166 | onchainProfile, attestedProfile, attester, darkFor |
| 9. RPC | 5253 | 194 | decimals, symbol |
| 10. GraphQL | 14716 | 362 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 11. registry | 15079 | 612 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 12. RPC | 15760 | 500 | decimals, symbol |
| 13. RPC | 16328 | 1774 | nativeApproved, templateOf, nativeApproved, templateOf |
| 14. RPC | 18170 | 248 | nativeTemplate, nativeTemplate |
| 15. RPC | 18453 | 188 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 16. RPC | 20252 | 153 | darkFor |

## before-local — warm

Summary: 2868 ms; full terms sentence: 2868 ms.

| Request | Start | Duration | Work |
|---|---:|---:|---|
| 1. GraphQL | 35 | 319 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 2. registry | 356 | 576 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 3. RPC | 1003 | 989 | decimals, symbol |
| 4. RPC | 2063 | 350 | nativeApproved, templateOf, nativeApproved, templateOf |
| 5. RPC | 2481 | 164 | nativeTemplate, nativeTemplate |
| 6. RPC | 2679 | 180 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 7. RPC | 2903 | 526 | eth_blockNumber, covenant |
| 8. RPC | 3499 | 170 | onchainProfile, attestedProfile, attester, darkFor |
| 9. RPC | 3738 | 212 | decimals, symbol |
| 10. GraphQL | 12860 | 367 | Full protocol: Issuer, Bond, DailyRevenue, PayerTotal, CovenantCheck |
| 11. registry | 13227 | 580 | accounts=0x0c58ce2d764c089aefe8da8ca27c2e521bdc31f5; 0x9decb240f7e063fcc090af740341b956b7a3b079; 0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343; 0x16813a1ba366ea5d1375f5b64b0bc8348642a735; 0xb6f44e47c7468c42a32d9679170cc3c4b145099b |
| 12. RPC | 13877 | 722 | decimals, symbol |
| 13. RPC | 14667 | 167 | nativeApproved, templateOf, nativeApproved, templateOf |
| 14. RPC | 14904 | 181 | nativeTemplate, nativeTemplate |
| 15. RPC | 15118 | 173 | activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, activationTime, collectionClosedAt, settleAfter, defaultedAt, policyHash, source, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed, terms, name, symbol, backingPerToken, depositAllowed |
| 16. RPC | 18741 | 426 | darkFor |

## after — cold

Summary: 883 ms; full terms sentence: 3154 ms.

| Request | Start | Duration | Work |
|---|---:|---:|---|
| server GraphQL | during HTML response | 797 | Bond(id) + Issuer(activeBond), 30-second server cache |
| 1. GraphQL | 953 | 2123 | AccountEvidence |
| 2. GraphQL | 953 | 2124 | BondChecks |
| 3. registry | 953 | 2643 | accounts=0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343 |
| 4. RPC | 983 | 2163 | terms, name, symbol, activationTime, collectionClosedAt, settleAfter, defaultedAt, source |
| 5. RPC | 1017 | 2129 | depositAllowed |
| 6. RPC | 3120 | 167 | eth_blockNumber |
| 7. RPC | 3222 | 195 | holdings, covenant |
| 8. RPC | 3355 | 191 | onchainProfile, attestedProfile, attester |
| 9. RPC | 3491 | 196 | darkFor |
| 10. RPC | 18755 | 3197 | darkFor |

## after — warm

Summary: 29 ms; full terms sentence: 245 ms.

| Request | Start | Duration | Work |
|---|---:|---:|---|
| server GraphQL | during HTML response | 1 | Bond(id) + Issuer(activeBond), 30-second server cache |
| 1. GraphQL | 42 | 339 | AccountEvidence |
| 2. GraphQL | 42 | 339 | BondChecks |
| 3. registry | 42 | 647 | accounts=0x067861e4bf4803a66db97cf74e252b6f4927fa54&bonds=0x66a9aafad577a6319645f4e2e2daaad42a987343 |
| 4. RPC | 74 | 166 | terms, name, symbol, activationTime, collectionClosedAt, settleAfter, defaultedAt, source |
| 5. RPC | 108 | 189 | depositAllowed |
| 6. RPC | 280 | 207 | eth_blockNumber, holdings |
| 7. RPC | 456 | 180 | covenant |
| 8. RPC | 554 | 160 | onchainProfile, attestedProfile, attester |
| 9. RPC | 704 | 222 | darkFor |
| 10. RPC | 15994 | 6582 | darkFor |
