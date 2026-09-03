using System;
using System.Text;
using UnityEngine;

namespace ForgeMind.Client.Contracts
{
    public static class ForgeMindJson
    {
        public static bool TryDeserialize<T>(string json, out T value, out string error)
        {
            value = default;
            error = string.Empty;
            if (string.IsNullOrWhiteSpace(json))
            {
                error = "JSON payload is empty.";
                return false;
            }

            try
            {
                value = JsonUtility.FromJson<T>(json);
                if (value == null)
                {
                    error = "JSON payload produced a null value.";
                    return false;
                }
                return true;
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return false;
            }
        }

        public static string Serialize<T>(T value)
        {
            return JsonUtility.ToJson(value);
        }

        public static string Quote(string value)
        {
            var text = value ?? string.Empty;
            var output = new StringBuilder(text.Length + 2);
            output.Append('"');
            foreach (var character in text)
            {
                switch (character)
                {
                    case '"': output.Append("\\\""); break;
                    case '\\': output.Append("\\\\"); break;
                    case '\b': output.Append("\\b"); break;
                    case '\f': output.Append("\\f"); break;
                    case '\n': output.Append("\\n"); break;
                    case '\r': output.Append("\\r"); break;
                    case '\t': output.Append("\\t"); break;
                    default:
                        if (character < 0x20) output.Append("\\u").Append(((int)character).ToString("x4"));
                        else output.Append(character);
                        break;
                }
            }
            output.Append('"');
            return output.ToString();
        }
    }
}
