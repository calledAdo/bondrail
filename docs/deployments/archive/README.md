# Judged deployment archive

`10143-slice-metropolis.json` is the unmodified Slice deployment manifest previously
stored at `docs/deployments/10143.json`. It is a read-only historical reference for
the `metropolis-submission` tag and `BUILD_LOG.md`; its service URLs are retired.
Do not regenerate it, load it with current ABIs, or use it as an operational target.

The active Bondrail deployment is `../10143.json`, selected by the default
`BONDRAIL_DEPLOYMENT=main`. Named deployments use `../<chainId>-<name>.json`;
the operational loader does not search this archive.
