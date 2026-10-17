import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Reproduce PackageKit's /tmp -> /private/tmp entry path without privileges,
// an installed Word, or any installation side effects. Invalid requests must
// reach the CLI and fail explicitly; silently exiting with status 0 is a bug.
for (const fixture of [
  {file:'automatic-install.mjs',args:['--service-only','--uid','-1'],input:'',error:/后台服务用户不匹配/},
  {file:'installer.mjs',args:[],input:'not JSON',error:/INVALID_REQUEST/},
  {file:'build-automatic-pkg.mjs',args:[],input:'not JSON',error:/"ok":false/}
]) {
  test(`installer CLI executes through a symlinked directory: ${fixture.file}`, async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'equationlab-cli-entry-'));
    try {
      const source = fileURLToPath(new URL('../packaging/word-native-installer/',import.meta.url));
      const linked = path.join(temporary,'linked-installer');
      await fs.symlink(source,linked,'dir');
      const result = spawnSync(process.execPath,[path.join(linked,fixture.file),...fixture.args],
        {input:fixture.input,encoding:'utf8',timeout:10000});
      assert.equal(result.error,undefined);
      assert.equal(result.status,1);
      assert.match(result.stdout+result.stderr,fixture.error);
    } finally { await fs.rm(temporary,{recursive:true,force:true}); }
  });
}
