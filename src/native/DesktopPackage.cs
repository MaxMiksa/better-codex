using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;

internal sealed class DesktopPackage
{
    internal const string Family = "OpenAI.Codex_2p2nqsd0c76g0";
    public string executable { get; private set; }
    public string packageVersion { get; private set; }
    public string packageFamily { get { return Family; } }
    public string packageFullName { get; private set; }

    internal object WithDigest()
    {
        using (var hash = SHA256.Create())
        using (var stream = File.OpenRead(executable))
            return new { executable, packageVersion, packageFamily, packageFullName,
                sha256 = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() };
    }

    // .NET Framework projects installed WinRT metadata at runtime. No SDK
    // reference assemblies or separate PowerShell process are needed.
    private static Type WinRt(string name, string metadata)
    {
        return Type.GetType(name + ", " + metadata + ", ContentType=WindowsRuntime", true);
    }

    private static object Property(Type type, object obj, string name)
    {
        return type.GetProperty(name).GetValue(obj, null);
    }

    internal static DesktopPackage Discover()
    {
        var managerType = WinRt("Windows.Management.Deployment.PackageManager", "Windows.Management.Deployment");
        var packageType = WinRt("Windows.ApplicationModel.Package", "Windows.ApplicationModel");
        var idType = WinRt("Windows.ApplicationModel.PackageId", "Windows.ApplicationModel");
        var statusType = WinRt("Windows.ApplicationModel.PackageStatus", "Windows.ApplicationModel");
        var folderType = WinRt("Windows.Storage.StorageFolder", "Windows.Storage");
        object manager = Activator.CreateInstance(managerType);
        var find = managerType.GetMethod("FindPackagesForUser", new[] { typeof(string), typeof(string) });
        var packages = ((IEnumerable)find.Invoke(manager, new object[] { "", Family })).Cast<object>()
            .Where(p => !((bool)Property(packageType, p, "IsResourcePackage")) &&
                        !((bool)Property(packageType, p, "IsFramework")) &&
                        !((bool)Property(packageType, p, "IsBundle"))).ToArray();
        if (packages.Length != 1) throw new InvalidOperationException();
        object package = packages[0], id = Property(packageType, package, "Id");
        if (!String.Equals((string)Property(idType, id, "FamilyName"), Family, StringComparison.Ordinal) ||
            Convert.ToInt32(Property(packageType, package, "SignatureKind")) != 3 ||
            !(bool)statusType.GetMethod("VerifyIsOK").Invoke(Property(packageType, package, "Status"), null))
            throw new InvalidOperationException();
        string fullName = (string)Property(idType, id, "FullName");
        string directory = (string)Property(folderType, Property(packageType, package, "InstalledLocation"), "Path");
        string executable = Path.Combine(directory, "app", "ChatGPT.exe");
        if (!File.Exists(executable)) throw new FileNotFoundException();
        return new DesktopPackage { executable = executable, packageFullName = fullName, packageVersion = fullName.Split('_')[1] };
    }
}
