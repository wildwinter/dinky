# Third-Party Licenses

Dinky incorporates the following third-party components. Their licenses are reproduced below.

---

## English Spelling Dictionaries

The spell-checking dictionaries bundled in this distribution (`public/dictionaries/en-GB.*`
and `public/dictionaries/en-US.*`) are sourced from the
[dictionary-en-gb](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en-GB) and
[dictionary-en](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en) packages
maintained by Titus Wormer, which repackage the
[SCOWL (Spell Checker Oriented Word Lists)](http://wordlist.aspell.net/) Hunspell dictionaries.

These files are licensed under `(MIT AND BSD)`.

### MIT License (package wrapper)

Copyright (c) Titus Wormer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### BSD License (SCOWL word list data)

Copyright (c) 2000-2016 by Kevin Atkinson

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of Kevin Atkinson nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY KEVIN ATKINSON AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL KEVIN ATKINSON OR CONTRIBUTORS
BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGE.

---

## Dink Compiler and Viewer

The `DinkCompiler` and `DinkViewer` binaries bundled in the `resources/compiler/` directory
are from the [Dink](https://github.com/wildwinter/dink) project.

MIT License — Copyright (c) 2025 Ian Thomas

---

## Ink / Inklecate

The `DinkCompiler` binary incorporates `ink_compiler.dll` and `ink-engine-runtime.dll` from
[Ink](https://github.com/inkle/ink) by inkle Ltd. These are compiled into the DinkCompiler
single-file binary via [Ink-Localiser](https://github.com/wildwinter/Ink-Localiser).

MIT License

Copyright (c) 2025 inkle Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Ink-Localiser

The `DinkCompiler` binary incorporates
[Ink-Localiser](https://github.com/wildwinter/Ink-Localiser) (`wildwinter.LocaliserLib`),
a library for adding localisation IDs to Ink files and exporting string tables.

MIT License — Copyright (c) 2024 Ian Thomas

---

## Google Cloud Text-to-Speech

The `DinkCompiler` binary incorporates the
[Google Cloud Text-to-Speech client library](https://github.com/googleapis/google-cloud-dotnet)
(`Google.Cloud.TextToSpeech.V1`) for optional placeholder audio generation.

Licensed under the Apache License, Version 2.0.

Copyright 2025 Google LLC

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship made available under
      the License, as indicated by a copyright notice that is included in
      or attached to the work (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other transformations
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean, as submitted to the Licensor for inclusion
      in the Work by the copyright owner or by an individual or Legal Entity
      authorized to submit on behalf of the copyright owner.

      "Contributor" shall mean Licensor and any Legal Entity on behalf of
      whom a Contribution has been received by the Licensor and has been
      incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by the combined work. If You institute patent
      litigation against any entity (including a cross-claim or counterclaim
      in a lawsuit) alleging that the Work or any infringes a patent or other
      intellectual property right, then any patent rights granted to You
      under this License for that Work shall terminate as of the date such
      litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the Work
      or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You meet
      the following conditions:

      (a) You must give any other recipients of the Work or Derivative Works
          a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works that
          You distribute, all copyright, patent, trademark, and attribution
          notices from the Source form of the Work, excluding those notices
          that do not pertain to any part of the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, You must include a readable copy of the attribution
          notices contained in that NOTICE file in any Derivative Works
          that You distribute, alongside or as an addendum to the NOTICE
          text from the Work, provided that such additional notices cannot
          be construed as modifying the License.

      You may add Your own attribution notices within Derivative Works that
      You distribute, alongside or as an addendum to the NOTICE text from
      the Work, provided that such additional notices cannot be construed
      as modifying the License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or agreed
      to in writing, Licensor provides the Work (and each Contributor
      provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES
      OR CONDITIONS OF ANY KIND, either express or implied, including,
      without limitation, any warranties or conditions of TITLE,
      NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR
      PURPOSE. You are solely responsible for determining the
      appropriateness of using or reproducing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or exemplary damages of any character arising as a result
      of this License or out of the use or inability to use the Work,
      even if such Contributor has been advised of the possibility of such
      damages.

   9. Accepting Warranty or Liability. While redistributing the Work or
      Derivative Works thereof, You may choose to offer, and charge a fee
      for, acceptance of support, warranty, indemnity, or other liability
      obligations and/or rights consistent with this License. However, in
      accepting such obligations, You may offer such obligations only on
      Your own behalf and on Your sole responsibility, not on behalf of any
      other Contributor, and only if You agree to indemnify, defend, and
      hold each Contributor harmless for any liability incurred by, or
      claims asserted against, such Contributor by reason of your accepting
      any such warranty or liability.

---

## Runtime npm Dependencies

All npm runtime dependencies listed in `package.json` are MIT licensed. Key ones:

| Package | License | Author/Origin |
|---------|---------|---------------|
| [inkjs](https://github.com/y-lohse/inkjs) | MIT | Yannick Lohse |
| [monaco-editor](https://github.com/microsoft/monaco-editor) | MIT | Microsoft |
| [nspell](https://github.com/wooorm/nspell) | MIT | Titus Wormer |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | electron-userland |
| [@wildwinter/simple-vc-lib](https://github.com/wildwinter/simple-vc-lib) | MIT | Ian Thomas |

Electron itself is MIT licensed. See `LICENSE.electron.txt` included in the distribution.

## Bundled C# Dependencies (MIT)

The following NuGet packages compiled into the Dink binaries are MIT licensed:

| Package | License | Author/Origin |
|---------|---------|---------------|
| [ClosedXML](https://github.com/ClosedXML/ClosedXML) | MIT | ClosedXML contributors |
| [PDFsharp-MigraDoc](https://github.com/empira/PDFsharp) | MIT | empira Software GmbH |
| [DocumentFormat.OpenXml](https://github.com/dotnet/Open-XML-SDK) | MIT | Microsoft |
| [System.CommandLine](https://github.com/dotnet/command-line-api) | MIT | Microsoft |
| [wildwinter.SimpleVCLib](https://github.com/wildwinter/simple-vc-lib) | MIT | Ian Thomas |
